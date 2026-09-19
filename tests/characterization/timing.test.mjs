// Rhythm taps are judged against the AudioContext clock, not the wall clock
// the browser reads when the tap HANDLER happens to run. These tests drive
// window.__coach.tap() with a fabricated event (only { timeStamp } matters,
// per the fallback onTap keeps for the note-input/MIDI call path) so the
// tap's audio-clock time can be pinned exactly, independent of real-time
// jitter in this test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Builds a fake DOM-event timeStamp that toAudioTime() will resolve back to
// `targetAudioTime` (AudioContext seconds), using a same-instant sample of
// (performance.now(), audioContext.currentTime) as the conversion anchor —
// exactly the anchor onTap itself takes when the tap actually happens.
async function fakeTimeStampFor(page, targetAudioTime) {
  const [refAudio, refPerf] = await page.evaluate('[window.__coach.audioNow(), performance.now()]');
  const offset = refAudio - refPerf / 1000;
  return (targetAudioTime - offset) * 1000;
}

async function playOneBar(page, latencyMs) {
  await page.evaluate("window.__coach.setMod('rhy')");
  await page.evaluate(`window.__coach.db().latencyMs = ${latencyMs}`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets.length > 0');
  return page.evaluate('window.__coach.bar().onsets[0].t');
}

test('CHARACTERIZATION (E4 fix): a tap 200ms after the beat is judged on-time once latencyMs covers it', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const onsetTime = await playOneBar(page, 200);
  const fakeTs = await fakeTimeStampFor(page, onsetTime + 0.2);
  await page.evaluate(`window.__coach.tap({ timeStamp: ${fakeTs} })`);

  await page.waitFor('window.__coach.bar().judged', 12000);
  const hit = await page.evaluate('window.__coach.bar().onsets[0].hit');
  assert.notEqual(hit, null, 'a tap 200ms late should be pulled back on-time by a 200ms latency figure');
  assert.ok(Math.abs(hit) < 0.05, `expected the corrected hit offset near 0s, got ${hit}`);
});

test('CHARACTERIZATION (E4 fix): the same 200ms-late tap is judged missed with no latency correction', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const onsetTime = await playOneBar(page, 0);
  const fakeTs = await fakeTimeStampFor(page, onsetTime + 0.2);
  await page.evaluate(`window.__coach.tap({ timeStamp: ${fakeTs} })`);

  await page.waitFor('window.__coach.bar().judged', 12000);
  const hit = await page.evaluate('window.__coach.bar().onsets[0].hit');
  assert.equal(hit, null, 'a tap 200ms late should stay outside the acceptance window with no latency correction');
});

test('CHARACTERIZATION: garbage latencyMs is sanitised on reload (0..300ms)', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const [raw, expected] of [[-5, 0], [9999, 300], ['x', 0]]) {
    await page.evaluate(`
      (function () {
        const db = JSON.parse(localStorage.getItem('bandcoach.v1') || 'null') || {};
        db.latencyMs = ${JSON.stringify(raw)};
        localStorage.setItem('bandcoach.v1', JSON.stringify(db));
      })()
    `);
    await page.evaluate('location.reload()');
    await page.waitFor('typeof window.__coach !== "undefined"', 8000);
    await page.waitFor('window.__coach.db().mods.kbd', 5000);
    const got = await page.evaluate('window.__coach.db().latencyMs');
    assert.equal(got, expected, `latencyMs ${JSON.stringify(raw)} should sanitise to ${expected}, got ${got}`);
  }
});
