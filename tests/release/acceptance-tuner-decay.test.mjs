// Acceptance version of the README human check's tuner-decay step, which
// tests/release/gate.test.mjs automates with in-page clicks and a microphone
// granted by launch flag. The same decaying A4 goes through the same fake
// microphone DEVICE, but the way in is a learner's: real clicks, a real
// keyboard choice of tuning, a browser-level mic grant, no permissive flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAcceptancePage, effectiveWaitMs } from '../helpers/browser.mjs';
import { writeDecayWav } from '../fixtures/acceptance/decay-wav.mjs';

// Observation only: the text painted on the canvas this frame (reset on each
// clearRect), so "is A on screen now" is not "was A ever drawn".
const CANVAS_TEXT_RECORDER = `
  (function () {
    window.__bcCanvasText = [];
    var proto = CanvasRenderingContext2D.prototype;
    var origFillText = proto.fillText, origClearRect = proto.clearRect;
    proto.clearRect = function () { window.__bcCanvasText = []; return origClearRect.apply(this, arguments); };
    proto.fillText = function (text) { window.__bcCanvasText.push(String(text)); return origFillText.apply(this, arguments); };
  })();
`;

test('tuner readout survives a decaying note through the silence after it (real clicks, browser-level mic grant)', async (t) => {
  const wavPath = writeDecayWav(join(mkdtempSync(join(tmpdir(), 'band-coach-wav-')), 'a4-pluck-440hz.wav'));
  await withAcceptancePage(
    t,
    { fakeAudioFile: wavPath, initScript: CANVAS_TEXT_RECORDER, simulated: ['canvas text recorder (observes only, adds no input)'] },
    async (page) => {
      await page.grant(['microphone']);

      // Tuner, then the ukulele tuning (4th string A4, the note played), chosen
      // as a keyboard user does: focus the list, type its first letter, Enter.
      await page.clickSelector('#picker button[data-mod="tuner"]');
      await page.clickSelector('#optTune');
      await page.press('u', { text: 'u' });
      await page.press('Enter');
      await page.waitFor("document.getElementById('optTune').value === 'uke'");

      // "Set up input", Connect, then wait for the app to say it is listening.
      await page.clickSelector('#setupBtn');
      await page.clickSelector('#ioBtn');
      await page.waitFor("document.getElementById('ioBtn').hidden === true");
      assert.match(await page.evaluate("document.getElementById('ioText').textContent"), /Listening/, 'the app says it is listening');

      const currentFrameShowsA = () => page.evaluate("window.__bcCanvasText.indexOf('A') !== -1");
      const detectDeadline = Date.now() + effectiveWaitMs(8000);
      let firstSeenAt = null;
      while (Date.now() < detectDeadline) {
        if (await currentFrameShowsA()) { firstSeenAt = Date.now(); break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(firstSeenAt, 'the tuner readout never showed A even once while the fake microphone played 440 Hz');

      // The tuner holds the readout through 1500ms of continuous silence
      // (src/core/tuner.js stepTuner), so every sample in the 900ms after first
      // detection must still show the note.
      const persistUntil = firstSeenAt + 900;
      while (Date.now() < persistUntil) {
        assert.ok(
          await currentFrameShowsA(),
          `the tuner readout disappeared ${Date.now() - firstSeenAt}ms after it first showed the note, well inside the product's own 1500ms hold-through-silence window`,
        );
        await new Promise((r) => setTimeout(r, 75));
      }
      assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
    },
  );
});
