// Q10d-3: a note already passed and still ringing is not judged against the next item because of
// a false onset or a capture dropout. Live capture (tests/release/acceptance-live-capture.test.mjs
// T1/T4/T7) showed two shapes under load: the level of the ring dips (a clarity dropout, a stalled
// capture) and comes back, which the energy-flux detector reads as an attack, and an exact-0 rms
// frame heard when the next item starts, which present() read as the string having gone quiet.
// A fresh pluck on a ringing string adds energy to it, so an onset only counts when the frame is
// louder than the ring's decaying envelope. Same dev hook as after-pass-ring.test.mjs: pitchFrame()
// drives the real onPitch. G3 is the control: a real re-pluck over a ring is still heard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const frame = (m, rms, extra) => ({ rms, freq: 440 * Math.pow(2, (m - 69) / 12), midi: m, clarity: 0.95, onset: false, ...extra });
const feed = async (page, fr) => { await page.waitFor('!window.__coach.deaf()'); await page.evaluate(`window.__coach.pitchFrame(${JSON.stringify(fr)}, 0.02)`); };
const feedAll = async (page, frs) => { for (const fr of frs) await feed(page, fr); };
const three = (m, rms, onset) => [frame(m, rms, { onset: !!onset }), frame(m, rms), frame(m, rms)];
const read = (page, expr) => page.evaluate(expr);

async function begin(t) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await read(page, "window.__coach.setMod('gtr')");
  await read(page, 'window.__coach.startWithoutMic()');
  await page.waitFor('window.__coach.task()');
  await read(page, 'window.__t0 = null; window.__coach.task().limit = 1e9; window.__first = window.__coach.cur().info');
  const g = await read(page, 'window.__coach.gates()');
  return { page, loud: g.note * 10 };
}
async function pass(page, loud) {
  const m = await read(page, 'window.__coach.cur().info.midi');
  await read(page, 'window.__t0 = window.__coach.task()');
  await feedAll(page, three(m, loud, true));
  await page.waitFor('window.__coach.task().done');
  assert.equal(await read(page, "document.getElementById('feedback').className"), 'ok', 'the first pluck is passed');
  return m;
}
async function nextTask(page) {
  await page.waitFor('window.__coach.task() && window.__coach.task() !== window.__t0 && !window.__coach.task().done');
  await read(page, 'window.__coach.task().limit = 1e9');
}
const judged = (page) => read(page, "({ text: document.getElementById('feedback').textContent, done: window.__coach.task().done, failed: !!(window.__coach.cur() || {}).failed })");
const dropout = (m, loud) => frame(m, loud, { freq: 0, clarity: 0.3 });

test('G1 a level dip and rebound on the ring (a false onset) is not judged against the next item', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  await feedAll(page, [dropout(m1, loud), frame(m1, loud * 0.4, { freq: 0, clarity: 0.2 }), frame(m1, loud * 0.8, { freq: 0, clarity: 0.2, onset: true }), ...three(m1, loud * 0.8)]);
  const j = await judged(page);
  assert.doesNotMatch(j.text, /That was/, `the ringing note was judged: ${j.text}`);
  assert.ok(!j.failed && !j.done);
});

test('G2 an exact-0 capture dropout heard as the next item starts does not release the ring', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await feed(page, frame(m1, 0, { freq: 0, clarity: 0 })); // heard.rms === 0 when present() runs
  await nextTask(page);
  await feedAll(page, [dropout(m1, loud), ...three(m1, loud)]);
  const j = await judged(page);
  assert.doesNotMatch(j.text, /That was/, `the ringing note was judged: ${j.text}`);
  assert.ok(!j.failed && !j.done);
});

test('G3 control: a real re-pluck, louder than the ring, is still heard as the same note', async (t) => {
  const { page, loud } = await begin(t);
  const m1 = await pass(page, loud);
  await nextTask(page);
  await read(page, 'window.__coach.cur().info = window.__first');
  await feedAll(page, three(m1, loud * 1.6, true));
  assert.equal((await judged(page)).done, true, 'a fresh pluck over the ring was not heard');
});
