// "Calibrate timing" is on every instrument's option row, not only Rhythm reading:
// a MIDI keyboard, a drum-kit pad or the space bar all count as taps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const feedback = "document.getElementById('feedback').textContent";

async function begin(page, mod, withMidi) {
  await page.evaluate("window.__coach.setMod('" + mod + "')");
  if (withMidi) {
    await midiAddPort(page, 'p1', 'Test Keys');
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
  }
  await page.waitFor("document.getElementById('calBtn')");
  assert.equal(await page.evaluate("document.getElementById('calBtn').textContent"), 'Calibrate timing (0 ms)');
  await page.evaluate("document.getElementById('calBtn').click()");
  await page.waitFor(feedback + " === 'Tap along with the eight clicks.'");
}

for (const [mod, note] of [['kbd', 60], ['drum-kit', 38]]) {
  test('Calibrate timing on ' + mod + ' counts a MIDI note-on as a tap', async (t) => {
    const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
    t.after(() => page.close());
    await begin(page, mod, true);
    await page.evaluate("window.__midiSend('p1', [0x90, " + note + ", 100]); window.__midiSend('p1', [0x80, " + note + ", 0]);");
    await page.waitFor(feedback + " === 'Caught 1 of 8 taps.'", 3000);
    assert.deepEqual(page.exceptions, []);
  });
}

test('Calibrate timing on a microphone instrument counts the space bar', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await begin(page, 'gtr', false);
  await page.evaluate("document.activeElement && document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))");
  await page.waitFor(feedback + " === 'Caught 1 of 8 taps.'", 3000);
  assert.deepEqual(page.exceptions, []);
});
