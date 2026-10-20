// Journey 4 of 4 (keyboard learner): hand-alone practice at level 13 unlocks Both.
// Setup and helpers: ./kbd-journey-shared.mjs (see its header for the rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';
import { htmlPath, connectFakeMidi, selectKbdMod } from './kbd-journey-shared.mjs';

// -----------------------------------------------------------------------
// Scenario 4: a learner reaches level 13 ("Hands together") the real way --
// twelve real #harderBtn clicks, never window.__coach.state().level= -- and
// plays each hand alone on real fake MIDI until Both unlocks, then switches
// to it with a real change event on the Hands selector. Reference for the
// unlock rule and the real-MIDI-per-element pattern:
// tests/characterization/kbd-hand-alone-gate.test.mjs (db()/cur().info are
// reads only, the one thing no real entry point can be asked for, same as
// that suite's own use of them).
// -----------------------------------------------------------------------
test('journey 4: hand-alone practice at level 13 unlocks Both, reached entirely through real clicks', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await selectKbdMod(page);
  await connectFakeMidi(page);

  for (let i = 1; i < 13; i++) await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor('window.__coach.state().level === 13');

  await page.waitFor("!!document.getElementById('optKbdHands')");
  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), true, 'Both must start locked at a fresh level 13');
  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'right');

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Right hand alone, real MIDI, until j1r registers a graded attempt.
  for (let i = 0; i < 20; i++) {
    const reps = await page.evaluate("(window.__coach.db().mods.kbd.item.j1r || {}).reps || 0");
    if (reps > 0) break;
    const info = await page.evaluate('window.__coach.cur().info');
    await midiNoteOn(page, 'p1', info.ex.rh.midi);
    await page.waitFor("document.getElementById('feedback').className === 'ok'");
    await page.evaluate("document.getElementById('feedback').className = ''");
    await page.waitFor('window.__coach.task() && window.__coach.cur()');
  }
  assert.ok(await page.evaluate("(window.__coach.db().mods.kbd.item.j1r || {}).reps || 0") > 0, 'expected j1r to register a graded attempt within 20 elements');
  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), true, 'right alone is not enough on its own');

  // Real change event: switch to left alone. Each script block below runs in
  // the page's own top-level scope, so a bare `const` here would collide with
  // the next evaluate() below -- wrapped in a block statement to stay scoped.
  await page.evaluate(`{
    const sel = document.getElementById('optKbdHands');
    sel.value = 'left';
    sel.dispatchEvent(new Event('change'));
  }`);
  await page.waitFor('window.__coach.task() && window.__coach.cur()');

  for (let i = 0; i < 20; i++) {
    const reps = await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).reps || 0");
    if (reps > 0) break;
    const info = await page.evaluate('window.__coach.cur().info');
    await midiNoteOn(page, 'p1', info.ex.lh.midi);
    await page.waitFor("document.getElementById('feedback').className === 'ok'");
    await page.evaluate("document.getElementById('feedback').className = ''");
    await page.waitFor('window.__coach.task() && window.__coach.cur()');
  }
  assert.ok(await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).reps || 0") > 0, 'expected j1l to register a graded attempt within 20 elements');

  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), false, 'both hands alone must unlock Both');
  assert.equal(await page.evaluate("document.getElementById('kbdBothLock')"), null, 'the lock note must be gone once Both unlocks');

  // Real change event: switch to Both.
  await page.evaluate(`{
    const sel = document.getElementById('optKbdHands');
    sel.value = 'both';
    sel.dispatchEvent(new Event('change'));
  }`);
  await page.waitFor("document.getElementById('optKbdHands').value === 'both'");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  const bothId = await page.evaluate('window.__coach.cur().id');
  assert.match(bothId, /^j\d$/, 'a Both-hands element must carry the plain j<n> id, not a hand-alone j<n>r/j<n>l one');

  assert.deepEqual(page.exceptions, []);
});
