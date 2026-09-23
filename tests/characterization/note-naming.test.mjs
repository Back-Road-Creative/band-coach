// Wave J2: two selects beside Theme let a learner pick how notes are named
// -- letters, German (H/B), or fixed-do solfege, each in sharps, flats, or
// today's mixed spelling. Driven through the real controls (#optNoteSystem,
// #optAccidentals) and a real MIDI note (tests/helpers/fake-midi.mjs), not
// the debug hook, so this proves the shipped page reads a note the way the
// learner picked, not just the model behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

test('choosing German shows "H" for a B-natural MIDI note heard while not judging', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('optNoteSystem').value = 'german'");
  await page.evaluate("document.getElementById('optNoteSystem').dispatchEvent(new Event('change'))");

  await midiAddPort(page, 'p1', 'Fake Keyboard');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  await midiNoteOn(page, 'p1', 71); // B natural, not judging -> "<name> heard"

  await page.waitFor("/H heard/.test(document.getElementById('coach').textContent)", 4000).catch(() => {
    assert.fail('expected the coach line to read "H heard" once German naming is selected, got: ' + '');
  });
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /H heard/);
});

test('German choice survives a reload', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.getElementById('optNoteSystem').value = 'german'");
  await page.evaluate("document.getElementById('optNoteSystem').dispatchEvent(new Event('change'))");
  // save() is debounced (1.2 s), same as theme-toggle's reload test.
  await page.waitFor("(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).prefs.noteNaming.system === 'german'; } catch (e) { return false; } })()", 10000);

  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const selectValue = await page.evaluate("document.getElementById('optNoteSystem').value");
  assert.equal(selectValue, 'german');
});
