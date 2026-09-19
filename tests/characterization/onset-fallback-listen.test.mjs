// Second field-report defect: the AudioWorklet path has always fed onPitch
// an onset flag (src/audio/pitch-worklet.js -> src/app.js:113), but the
// setInterval(listen, 50) fallback used on any browser where the worklet
// fails to load never set fr.onset at all — so `if (fr.onset)` in onPitch's
// pluck branch (the F8 re-pluck detector) was permanently dead whenever the
// worklet was unavailable. This drives that fallback path specifically
// (AudioWorklet deleted before the app's own script runs, so
// ensurePitchWorklet() always fails and listen()'s setInterval is the only
// thing feeding onPitch) through the same real-mic-pipeline technique as
// tests/characterization/onset-repluck.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Removing audioWorklet from AudioContext.prototype before the page's own
// script runs makes createPitchNode() (src/audio/pitch-worklet.js) reject
// for every AudioContext the app creates, so pitchWorkletNode stays null and
// listen() never takes its early "worklet is feeding onPitch instead" exit.
const disableAudioWorkletScript = `
  Object.defineProperty(window.AudioContext.prototype, 'audioWorklet', { get: () => undefined });
`;

test('F8 fallback parity: a same-pitch re-pluck re-fires through the non-worklet listen() path', async (t) => {
  const page = await launchPage(htmlPath, { initScript: disableAudioWorkletScript });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  // Force a second element identical to the first, so the task keeps
  // waiting on the SAME note instead of finishing after the first pluck.
  await page.evaluate(`
    (function () {
      const t = window.__coach.task();
      t.els.push(Object.assign({}, t.els[0]));
    })()
  `);
  assert.equal(await page.evaluate('window.__coach.task().els.length'), 2);

  const freq = midiToFreq(info.midi);
  // A separate probe pluck to confirm the worklet is really unavailable
  // would pollute the fallback onset detector's own adaptive noise-floor
  // history with an unrelated attack before the real re-pluck below, so the
  // worklet-inactive check instead runs off the SAME real attacks the test
  // already needs.
  await page.evaluate(`window.__coach.testPluck(${freq}, [0, 500])`);
  assert.equal(await page.evaluate('window.__coach.pitchWorkletActive()'), false, 'the worklet must be unavailable for this test to prove anything about the fallback');

  await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

  assert.equal(
    await page.evaluate('window.__coach.task().idx'),
    2,
    'both identical-pitch attacks should have been credited as separate note events, proving fr.onset now reaches onPitch through listen() too'
  );
});
