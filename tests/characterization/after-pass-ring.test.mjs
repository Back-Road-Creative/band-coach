// Q10d: a note still ringing after a correct pluck is not judged against the NEXT item.
// src/app.js present() used to set `released = true` at every task start, so one pitch
// dropout on the ring (the pluck branch resets stableN on a frame it cannot pitch) let the
// same midi fire again against the new target: "That was E, the note is A" with nothing
// new played. These tests drive the real onPitch through the dev hook window.__coach.
// pitchFrame(frame, dt), the same frames the microphone chain delivers; no mic is connected,
// so only the frames below reach the judge. The re-pluck legs (F2, F3, F4, F5) are the
// negative controls: a real onset, a different note, a first pluck and a quiet restart
// still fire, so the green of F1/F1b/F6 is not "nothing is ever judged".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { releaseFloor } from '../../src/audio/levels.js';

const frame = (m, rms, extra) => ({ rms, freq: 440 * Math.pow(2, (m - 69) / 12), midi: m, clarity: 0.95, onset: false, ...extra });
const feed = async (page, fr) => { await page.waitFor('!window.__coach.deaf()'); await page.evaluate(`window.__coach.pitchFrame(${JSON.stringify(fr)}, 0.02)`); };
const feedAll = async (page, frs) => { for (const fr of frs) await feed(page, fr); };
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
  return { page, g, loud: g.note * 10, rf: releaseFloor(g), wobble: (releaseFloor(g) + g.note) / 2 };
}
const target = (page) => read(page, 'window.__coach.cur().info.midi');
// Plays the current target (three pitched frames, the first an onset) and waits for the pass.
async function pass(page, loud) {
  const m = await target(page);
  await read(page, 'window.__t0 = window.__coach.task()');
  await feedAll(page, three(m, loud, true));
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

// A frame the pluck branch cannot pitch, loud enough that the string is plainly still ringing.
const dropout = (m, loud) => frame(m, loud, { freq: 0, clarity: 0.3 });

test('F1 a ringing note with one pitch dropout is not judged against the next item', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  assert.notEqual(await target(page), m1, 'the next item is a different note');
  await feedAll(page, [dropout(m1, loud), ...three(m1, loud)]);
  notJudged(await judged(page), 'F1');
});

test('F1b a ringing note with one level wobble is not judged against the next item', async (t) => {
  const { page, loud, wobble } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  assert.notEqual(await target(page), m1);
  await feedAll(page, [frame(m1, wobble), ...three(m1, loud)]);
  notJudged(await judged(page), 'F1b');
});

test('F2 the same note on two tasks in a row needs a fresh pluck', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  await sameAsFirst(page);
  await feedAll(page, [dropout(m1, loud), ...three(m1, loud)]);
  assert.equal((await judged(page)).done, false, 'the ring alone passed the same note again');
  await feedAll(page, three(m1, loud, true)); // vacuity guard: a real re-pluck is heard
  const j = await judged(page);
  assert.equal(j.done, true, 'a fresh pluck of the same note was not heard');
  assert.equal(j.cls, 'ok');
});

test('F3 a different note still fires at once', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  const m2 = await target(page);
  assert.notEqual(m2, m1);
  await feedAll(page, [dropout(m1, loud), ...three(m1, loud)]);
  await feedAll(page, three(m2, loud)); // no onset: a different note needs none
  const j = await judged(page);
  assert.equal(j.done, true);
  assert.equal(j.cls, 'ok');
});

test('F4 the first task after Start hears the first pluck', async (t) => {
  const { page, loud } = await begin(t);
  await click(page, 'endBtn');
  await page.waitFor('!window.__coach.playing()');
  await feedAll(page, three(57, loud)); // a loud string heard while stopped
  await click(page, 'playBtn');
  await nextTask(page);
  await feedAll(page, three(await target(page), loud)); // no onset
  assert.equal((await judged(page)).done, true);
});

test('F5 after Stop and Start in a quiet room the same note passes without an onset', async (t) => {
  const { page, loud, rf, wobble } = await begin(t);
  const m1 = await pass(page, loud);
  await click(page, 'endBtn');
  await page.waitFor('!window.__coach.playing()');
  await feedAll(page, Array.from({ length: 3 }, () => frame(m1, rf / 2, { freq: 0 }))); // silence while stopped
  await click(page, 'playBtn');
  await nextTask(page);
  await sameAsFirst(page);
  // One wobble frame (the string settling, between the release floor and the note gate) restarts the
  // 3-frame count without releasing the note; the quiet heard at Start is what lets m1 fire.
  await feedAll(page, [frame(m1, wobble), ...three(m1, loud)]);
  const j = await judged(page);
  assert.equal(j.done, true, 'silence at Start did not release the note');
  assert.equal(j.cls, 'ok');
});

test('F6 after Stop and Start with the string still ringing, it is not judged', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await click(page, 'endBtn');
  await page.waitFor('!window.__coach.playing()');
  await feedAll(page, three(m1, loud)); // still ringing while stopped
  await click(page, 'playBtn');
  await nextTask(page);
  await sameAsFirst(page);
  await feedAll(page, [dropout(m1, loud), ...three(m1, loud)]);
  assert.equal((await judged(page)).done, false);
});
