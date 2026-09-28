// Level 13 ("Hands together") gates Both behind each hand alone: the Both
// option of the Hands selector (#optKbdHands) stays disabled -- and the task
// runs right-hand-only -- until the right hand alone (j<n>r) and the left
// hand alone (j<n>l) have each actually been shown, or an earlier genuinely
// used plain j<n> item grandfathers it open. Real entry points throughout
// (a fake MIDI port through the real ioBtn click handler, and a real
// change event on the select), never window.__coach.note()/db() as a
// shortcut past them -- only db() to seed/observe the model directly, which
// is the one thing no real entry point can be asked to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

// Precedent for forcing a re-render onto a level already set before the
// mod's options box first drew: tests/characterization/kbd-practice-song-
// handoff.test.mjs's double setMod('kbd') around the level assignment.
async function toLevel13(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate("window.__coach.setMod('kbd')");
}

test('fresh model: Both is disabled, the drill runs right-only, and the prep line names the starting position', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel13(page);

  const bothDisabled = await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled");
  assert.equal(bothDisabled, true);
  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'right');
  assert.equal(await page.evaluate('window.__coach.db().prefs.kbdHands'), 'both');

  const prepText = await page.evaluate("document.getElementById('kbdHandsPrep').textContent");
  assert.match(prepText, /right hand thumb \(finger 1\) on C4/);
  assert.match(prepText, /left hand little finger \(finger 5\) on C3/);
  const reviewText = await page.evaluate("document.getElementById('kbdHandsPrepReview').textContent");
  assert.match(reviewText, /Not yet checked by a player/);

  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\dr$/);

  const info = await page.evaluate('window.__coach.cur().info');
  await midiNoteOn(page, 'p1', info.ex.rh.midi);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  assert.deepEqual(page.exceptions, []);
});

test('live flip: playing each hand alone unlocks Both without a page reload', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await toLevel13(page);
  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Play right-hand-only elements until j1r registers a graded attempt
  // (reps > 0) -- seen alone (set the instant an element is BUILT, before
  // any note is played) must not be enough; see bothUnlocked()'s comment.
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

  // Switch to Left only with a real change event.
  await page.evaluate(`
    const sel = document.getElementById('optKbdHands');
    sel.value = 'left';
    sel.dispatchEvent(new Event('change'));
  `);
  await page.waitFor('window.__coach.task() && window.__coach.cur()');

  // The first left-only element is now BUILT -- seen just went to 1 -- but
  // no left note has been played yet, so reps is still 0. This is the
  // defect itself: the old code unlocked Both right here, on "shown", not
  // "played". Both must still read locked.
  assert.equal(await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).seen || 0") > 0, true, 'expected j1l to already be shown (seen) before any left note is played');
  assert.equal(await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).reps || 0"), 0, 'expected j1l to have no graded attempt yet');
  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), true, 'Both must stay locked on shown-only evidence, not merely "will unlock later"');
  assert.ok(await page.evaluate("document.getElementById('kbdBothLock')"), 'the lock note must still be present on shown-only evidence');

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

  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), false);
  assert.equal(await page.evaluate("document.getElementById('kbdBothLock')"), null);

  assert.deepEqual(page.exceptions, []);
});

test('grandfathered: an earlier genuinely used plain j-item keeps Both unlocked from the start', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate(`
    window.__coach.db().mods.kbd.item.j3 = { stability: 5, difficulty: 0.3, lastSeen: Date.now(), reps: 2, lapses: 0, seen: 3 };
  `);
  await page.evaluate("window.__coach.setMod('kbd')");

  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), false);
  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'both');

  await midiAddPort(page, 'p1', 'Test Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const id = await page.evaluate('window.__coach.cur().id');
  assert.match(id, /^j\d$/);

  assert.deepEqual(page.exceptions, []);
});
