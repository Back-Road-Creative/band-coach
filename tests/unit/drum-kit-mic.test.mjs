// The drum-kit trainer's microphone path, in the built page: a synthesized
// kick (low sine sweep) and a synthesized hi-hat (highpassed noise) are fed
// through the SAME analyser chain a real microphone uses (window.__coach's
// testDrumHit(), not the speaker-only drumHit() synth), so this proves
// listenDrums() -> src/audio/drum-classify.js -> onHit() end to end, without
// a real kit or a recorded fixture. A second pair of tests exercises the
// honesty rule directly: a mic hit the classifier could not name (piece
// null) still counts, leniently, toward a bar that wants a tom -- but a
// same-shaped hit from any OTHER source does not, since only a mic is
// genuinely unable to say which drum it heard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function startKit(page, level, tick = 0) {
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate(`window.__coach.state().level = ${level}; window.__coach.state().tick = ${tick}`);
  await page.evaluate('window.__coach.db().latencyMs = 0');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets && window.__coach.bar().onsets.length > 0');
  return page.evaluate('window.__coach.bar().onsets');
}

async function judged(page) {
  await page.waitFor('window.__coach.bar().judged', 20000);
  return page.evaluate("({ failed: window.__coach.task().els[0].failed, say: document.getElementById('feedback').textContent })");
}

// Schedules one testDrumHit() burst per onset, all in a single page call (see
// src/app.js's testDrumHit -- unlike testPluck/testSource it does not stop
// previously scheduled nodes, so several future hits can be queued at once).
async function feedMic(page, kind, onsets) {
  await page.evaluate(`window.__coach.testDrumHit(${JSON.stringify(onsets.map(o => ({ t: o.t })))}.map(function (h) {
    return { kind: ${JSON.stringify(kind)}, atMs: (h.t - window.__coach.audioNow()) * 1000 };
  }))`);
}

test('a synthesized kick through the microphone is heard as the kick, on time, with no synthesized echo', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 0); // level 1, tick 0: kick alone, four quarter notes
  assert.ok(onsets.every(o => o.pieces.join() === 'kick'));
  await feedMic(page, 'kick', onsets);
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
  const taps = await page.evaluate('window.__coach.bar().taps');
  assert.equal(taps.length, 4);
  assert.ok(taps.every(tp => tp.piece === 'kick' && tp.source === 'mic'));
  const hits = await page.evaluate('window.__coach.micHits()');
  assert.ok(hits.length >= 4, 'expected at least one micHits() entry per kick');
  assert.ok(hits.every(h => h.piece === 'kick' && h.confidence >= 0.5));
});

test('a synthesized hi-hat burst through the microphone is heard as the closed hi-hat', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 2); // level 1, tick 2: hi-hat (closed) alone
  assert.ok(onsets.every(o => o.pieces.join() === 'hihat-closed'));
  await feedMic(page, 'hihat', onsets);
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
  const taps = await page.evaluate('window.__coach.bar().taps');
  assert.ok(taps.every(tp => tp.piece === 'hihat-closed' && tp.source === 'mic'));
});

test('a mic hit the classifier could not name still passes a bar that wants a tom', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 5); // level 1, tick 5: floor tom alone
  assert.ok(onsets.every(o => o.pieces.join() === 'tom-floor'));
  // A mic that heard a hit but could not tell which drum reports piece null;
  // tapMatches() in tickKitBar() is the rule under test here.
  await page.evaluate(`(${JSON.stringify(onsets.map(o => o.t))}).forEach(function (t) {
    window.__coach.bar().taps.push({ t: t, piece: null, used: false, source: 'mic' });
  })`);
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
});

test('an unnamed hit from anything but a mic is NOT given that leniency -- only a mic is genuinely unable to name the drum', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 5); // level 1, tick 5: floor tom alone
  await page.evaluate(`(${JSON.stringify(onsets.map(o => o.t))}).forEach(function (t) {
    window.__coach.bar().taps.push({ t: t, piece: null, used: false, source: 'key' });
  })`);
  const r = await judged(page);
  assert.equal(r.failed, true);
  assert.match(r.say, /missed/);
});
