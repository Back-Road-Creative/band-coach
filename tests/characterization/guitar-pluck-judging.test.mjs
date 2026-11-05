// A hand check on a real guitar: the prompt said G, the mic plainly heard it (the fretboard showed it),
// and the pluck was never judged. Three ways the pluck branch of onPitch could stay silent or say too much:
// R1 a same-note re-pluck at an ordinary mic level: the worklet's onset detector needs a jump its fixed
//    floor (src/audio/onset.js minFlux) only a loud pluck makes, so the note stayed "still ringing" for
//    as long as the player kept plucking it. R2 is the same rule through the frames, R3 its control.
// F1 one pluck whose reading flips octave answered once per flip. F2 is its control: the right octave still passes.
// D1 a one-frame pitch dropout inside a pluck restarted the count, so a noisy pluck could never reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { writePluckWav } from '../helpers/pluck-wav.mjs';

const G3 = 55;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const frame = (m, rms) => ({ rms, freq: hz(m), midi: m, clarity: 0.95, onset: false });
const noPitch = (rms) => ({ rms, freq: 0, clarity: 0.5, onset: false });
const feed = async (page, frs, dt = 0.012) => {
  for (const fr of frs) {
    await page.waitFor('!window.__coach.deaf()');
    await page.evaluate(`window.__coach.pitchFrame(${JSON.stringify(fr)}, ${dt})`);
  }
};
const rep = (n, fr) => Array.from({ length: n }, () => fr);
// Two elements asking for `midi`, with the time limit out of the way.
const forceTarget = (page, midi) => page.evaluate(`(() => {
  const t = window.__coach.task(); t.limit = 1e9; t.idx = 0;
  const e = t.els[0]; e.info = Object.assign({}, e.info, { midi: ${midi} });
  t.els = [e, Object.assign({}, e)];
})()`);
const idx = (page) => page.evaluate('window.__coach.task().idx');
const misses = (page) => page.evaluate('Object.values(window.__coach.state().conf).reduce((a, b) => a + b, 0)');

async function begin(t) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.waitFor('window.__coach.task()');
  const g = await page.evaluate('window.__coach.gates()');
  return { page, g };
}

test('R1: a same-note re-pluck at an ordinary mic level counts, through the real worklet', async (t) => {
  const SR = 48000, every = 2, n = SR * every * 6, x = new Float32Array(n), f = hz(G3), peak = 0.06;
  for (let at = 0; at < 6; at++) for (let h = 1; h <= 5; h++) for (let k = at * every * SR; k < n; k++) {
    const s = k / SR - at * every;
    x[k] += peak * (h === 1 ? 1 : 0.6 / h) * Math.sin(2 * Math.PI * f * h * s) * Math.exp(-s / 1.6 / (0.6 + 0.3 * h));
  }
  const wav = join(mkdtempSync(join(tmpdir(), 'repluck-')), 'g.wav');
  writePluckWav(wav, x, SR);
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wav });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate('window.__coach.setNoiseFloorForTest(0.0005)');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 8000);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.cur()', 8000);
  await forceTarget(page, G3);
  await page.waitFor('window.__coach.task().idx >= 2 || window.__coach.task().done', 12000);
  assert.ok((await idx(page)) >= 2, 'both plucks of the same note were judged');
});

test('R2: a louder pluck on a string still ringing releases the note, with no onset from the worklet', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  const ring = g.note * 4;
  await feed(page, rep(8, frame(G3, ring)));
  assert.equal(await idx(page), 1, 'the first pluck passes');
  await feed(page, rep(60, frame(G3, ring * 0.7)));
  assert.equal(await idx(page), 1, 'the ring alone is not a new pluck');
  await feed(page, [1.1, 1.3, 1.5, 1.7].map((k) => frame(G3, ring * k)).concat(rep(4, frame(G3, ring * 1.7))));
  assert.equal(await idx(page), 2, 'the re-pluck is judged');
});

test('R3 control: a ring that wobbles but never climbs past its own level is one pluck', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  const ring = g.note * 4;
  await feed(page, rep(8, frame(G3, ring)));
  for (let i = 0; i < 6; i++) await feed(page, [0.92, 0.84, 0.92, 1, 0.92, 0.84].map((k) => frame(G3, ring * k)));
  assert.equal(await idx(page), 1, 'still one response');
});

test('F1: one pluck whose reading flips octave gets one reply, not one per flip', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, 57);
  const before = await misses(page), ring = g.note * 4;
  await feed(page, [...rep(4, frame(G3, ring)), ...rep(4, frame(G3 + 12, ring)), ...rep(4, frame(G3, ring)), ...rep(4, frame(G3 + 12, ring))]);
  assert.equal((await misses(page)) - before, 1, 'one wrong-note reply');
});

test('F2 control: a first reading an octave off does not hide the right note when it settles', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  const ring = g.note * 4;
  await feed(page, [...rep(4, frame(G3 + 12, ring)), ...rep(4, frame(G3, ring))]);
  assert.equal(await idx(page), 1);
});

test('D1: a brief pitch dropout inside a pluck does not restart the count', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  const ring = g.note * 4;
  await feed(page, [frame(G3, ring), frame(G3, ring), noPitch(ring), frame(G3, ring)]);
  assert.equal(await idx(page), 1, 'three readings of the note, one gap between them');
});

test('D2 control: readings separated by real quiet are not one pluck', async (t) => {
  const { page } = await begin(t);
  await forceTarget(page, G3);
  const g = await page.evaluate('window.__coach.gates()'), ring = g.note * 4;
  await feed(page, [frame(G3, ring), frame(G3, ring), ...rep(20, noPitch(0.0005)), frame(G3, ring)]);
  assert.equal(await idx(page), 0);
});

test('D3 control: a long stretch with no clear pitch ends the count', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  const ring = g.note * 4;
  await feed(page, [frame(G3, ring), frame(G3, ring), ...rep(12, noPitch(ring)), frame(G3, ring)]);
  assert.equal(await idx(page), 0);
});

test('R4 control: a re-pluck whose level is still climbing when it is judged gets one reply', async (t) => {
  const { page, g } = await begin(t);
  await forceTarget(page, G3);
  await page.evaluate("window.__coach.task().els.push(Object.assign({}, window.__coach.task().els[0]))");
  const ring = g.note * 4;
  await feed(page, rep(8, frame(G3, ring)));
  await feed(page, rep(60, frame(G3, ring * 0.7)));
  await feed(page, [1.1, 1.3, 1.5, 1.7, 1.8, 1.8].map((k) => frame(G3, ring * k)).concat(rep(40, frame(G3, ring * 1.6))));
  assert.equal(await idx(page), 2, 'the first pluck and the re-pluck, and nothing for the rest of the climb');
});
