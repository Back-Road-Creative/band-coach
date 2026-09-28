// "Calibrate timing" (Rhythm reading's calBtn) listens for eight taps and
// stores the median offset as DB.latencyMs. A player with a MIDI keyboard
// or drum set taps along on that -- the same input every rhythm exercise
// already accepts (onNote routes a 'tap' module's notes to onTap()). Real
// entry points throughout: a fake MIDI port through the real ioBtn click
// handler and real calBtn clicks; window.__coach is only read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const feedback = "document.getElementById('feedback').textContent";
const coachText = "document.getElementById('coach').textContent";

async function startCalibrate(page) {
  await page.evaluate("window.__coach.setMod('rhy')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate("document.getElementById('calBtn').click()");
  await page.waitFor(`${feedback} === 'Tap along with the eight clicks.'`);
}

test('Calibrate timing counts MIDI note-ons as taps and shows each one caught', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startCalibrate(page);

  // Eight note-ons spaced well inside the ~6.5 s listening window; the
  // window accepts any offset (windowMs 1e9), so spacing is not judged.
  for (let i = 0; i < 8; i++) {
    await page.evaluate("window.__midiSend('p1', [0x90, 60, 100]); window.__midiSend('p1', [0x80, 60, 0]);");
    await page.waitFor(`${feedback} === 'Caught ${i + 1} of 8 taps.'`, 3000);
    assert.doesNotMatch(await page.evaluate(coachText), /heard/, 'a calibration tap is not an out-of-exercise note');
    await new Promise((r) => setTimeout(r, 250));
  }

  await page.waitFor(`/^Timing calibrated: -?\\d+ ms\\.$/.test(${feedback})`, 10000);
  const latency = await page.evaluate('window.__coach.db().latencyMs');
  assert.equal(typeof latency, 'number');
  assert.equal(await page.evaluate("document.getElementById('calBtn').textContent"), 'Calibrate timing (' + Math.round(latency) + ' ms)');
});

test('Calibrate timing with no taps still reports nothing caught', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await startCalibrate(page);
  await page.waitFor(`${feedback} === 'Not enough taps caught. Try again.'`, 10000);
});
