// Q10d-2: the ringing note of a PASSED item is released by delivered time, not by a count of frames.
// src/app.js's pluck branch used to release a ringing note on the third unpitched, quiet frame (and on
// the first one after a long ring), but the main thread gets worklet frames in bursts under load, so
// three frames can span almost no time: the ring was judged against the next item ("That was E, the
// note is A") with nothing new played. The rule now counts dt of delivered quiet (QUIET_RELEASE_SEC).
// Each case runs at two frame spacings (STEP 16 ms and 140 ms; the burst frames are always 4 ms apart),
// through the real onPitch via window.__coach.pitchFrame(frame, dt). G3, G4, G5a and G6b are green at
// the parent and at head (controls: real silence still releases, a fresh pluck and a different note
// still fire); G1, G6a and G7 are red at the parent.
// Not here: a recovery-onset rule (an onset quieter than the last 0.3 s is a dip's recovery, not a
// pluck). The F8 probe measured a real same-note re-pluck's onset frame at 0.98 of the ring's loudest
// frame, so that rule would drop a real re-pluck; it is left to JP (see the PR body).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import * as levels from '../../src/audio/levels.js';

const STEPS = [['16', 0.016], ['140', 0.14]];
const BURST_DT = 0.004;
const frame = (m, rms, extra) => ({ rms, freq: 440 * Math.pow(2, (m - 69) / 12), midi: m, clarity: 0.95, onset: false, ...extra });
const quiet = () => ({ rms: 0, freq: 0, clarity: 0, onset: false });
const feed = async (page, fr, dt) => { await page.waitFor('!window.__coach.deaf()'); await page.evaluate(`window.__coach.pitchFrame(${JSON.stringify(fr)}, ${dt})`); };
const feedAll = async (page, frs, dt) => { for (const fr of frs) await feed(page, fr, dt); };
const rep = (n, fn) => Array.from({ length: n }, fn);
const three = (m, rms, onset) => [frame(m, rms, { onset: !!onset }), frame(m, rms), frame(m, rms)];
const click = (page, id) => page.evaluate(`document.getElementById('${id}').click()`);
const read = (page, expr) => page.evaluate(expr);

// A gtr page on its first task (the one in front of the learner), with the timeout out of the way.
async function begin(t) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await read(page, "window.__coach.setMod('gtr')");
  await click(page, 'playBtn');
  await page.waitFor('window.__coach.task()');
  await read(page, 'window.__t0 = null; window.__coach.task().limit = 1e9; window.__first = window.__coach.cur().info');
  assert.notEqual(await read(page, 'window.__coach.cur().info.kind'), 'chord');
  const g = await read(page, 'window.__coach.gates()');
  return { page, loud: g.note * 10 };
}
const target = (page) => read(page, 'window.__coach.cur().info.midi');
// Plays the current target (three pitched frames, the first an onset) and waits for the pass.
async function pass(page, loud) {
  const m = await target(page);
  await read(page, 'window.__t0 = window.__coach.task()');
  await feedAll(page, three(m, loud, true), 0.02);
  await page.waitFor('window.__coach.task().done');
  assert.equal(await read(page, "document.getElementById('feedback').className"), 'ok', 'the first pluck is passed');
  return m;
}
// Waits for the next task the loop builds (a new object, not yet done) and lifts its timeout too.
async function nextTask(page) {
  await page.waitFor('window.__coach.task() && window.__coach.task() !== window.__t0 && !window.__coach.task().done');
  await read(page, 'window.__coach.task().limit = 1e9');
}
const sameAsFirst = (page) => read(page, 'window.__coach.cur().info = window.__first');
const judged = (page) => read(page, "({ text: document.getElementById('feedback').textContent, cls: document.getElementById('feedback').className, done: window.__coach.task().done, failed: !!(window.__coach.cur() || {}).failed })");
const notJudged = (j, what) => { assert.doesNotMatch(j.text, /That was/, `${what}: the ringing note was judged: ${j.text}`); assert.ok(!j.failed, `${what}: the item was failed`); assert.equal(j.done, false, `${what}: the item was passed`); };

for (const [id, STEP] of STEPS) {
  test(`G1 a burst of quiet frames is 36 ms, not a release (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    assert.notEqual(await target(page), m1, 'the next item is a different note');
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, rep(10, quiet), BURST_DT); // 9 counted gaps x 4 ms = 36 ms
    await feedAll(page, three(m1, loud), STEP);
    notJudged(await judged(page), 'G1');
  });

  test(`G3 a re-pluck after real silence fires (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    await sameAsFirst(page);
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, rep(5, quiet), 0.14); // 0.56 s of counted quiet
    await feedAll(page, [frame(m1, loud * 1.2, { onset: true }), frame(m1, loud), frame(m1, loud)], STEP);
    const j = await judged(page);
    assert.equal(j.done, true, 'a re-pluck after real silence was not heard');
    assert.equal(j.cls, 'ok');
  });

  test(`G4 an equal-level re-pluck on a ring fires (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    await sameAsFirst(page);
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, three(m1, loud, true), STEP);
    const j = await judged(page);
    assert.equal(j.done, true, 'a fresh pluck of the same note was not heard');
    assert.equal(j.cls, 'ok');
  });

  test(`G5a a different note after a ring fires (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    const m2 = await target(page);
    assert.notEqual(m2, m1);
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, three(m2, loud), STEP);
    const j = await judged(page);
    assert.equal(j.done, true);
    assert.equal(j.cls, 'ok');
  });

  test(`G6a one quiet frame of any length is not a release (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    await sameAsFirst(page);
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, [quiet()], 0.14); // the first quiet frame starts the clock and counts nothing
    await feedAll(page, three(m1, loud), STEP); // no onset
    assert.equal((await judged(page)).done, false, 'one quiet frame released the ringing note');
  });

  test(`G6b five quiet frames (real silence) release the note (step ${id})`, async (t) => {
    const { page, loud } = await begin(t);
    const m1 = await pass(page, loud);
    await nextTask(page);
    await sameAsFirst(page);
    await feedAll(page, rep(6, () => frame(m1, loud)), STEP);
    await feedAll(page, rep(5, quiet), 0.14);
    await feedAll(page, three(m1, loud), STEP); // no onset: the silence alone released the note
    const j = await judged(page);
    assert.equal(j.done, true, 'real silence did not release the note');
    assert.equal(j.cls, 'ok');
  });
}

test('G7 the release constant and the premises of the cases above', () => {
  assert.equal(typeof levels.QUIET_RELEASE_SEC, 'number');
  assert.ok(Number.isFinite(levels.QUIET_RELEASE_SEC) && levels.QUIET_RELEASE_SEC > 0);
  assert.ok(9 * BURST_DT < levels.QUIET_RELEASE_SEC, 'G1: the burst must be shorter than the release time');
  assert.ok(4 * 0.14 >= levels.QUIET_RELEASE_SEC, 'G3/G6b: real silence must be at least the release time');
  assert.ok(0.14 >= levels.QUIET_RELEASE_SEC, 'G6a: one long frame would release at once if the first quiet frame counted');
});
