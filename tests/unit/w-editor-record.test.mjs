// Pure logic behind the "Record a tune" panel's mic sampling
// (src/ui/editor/record.js): turning one analyser read into a raw pitch
// frame transcribe() can consume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleFrame, createRecorder } from '../../src/ui/editor/record.js';

const SR = 48000;
const N = 4096;

function sineBuf(freq, sr = SR, n = N, amp = 0.5) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return buf;
}

test('sampleFrame reports the sung/played pitch as midi with a t and confidence', () => {
  const frame = sampleFrame({ buf: sineBuf(440), sampleRate: SR, gate: 0.008, t: 1.5 });
  assert.ok(frame, 'a clean 440 Hz tone must produce a frame');
  assert.equal(Math.round(frame.midi), 69); // A4
  assert.equal(frame.t, 1.5);
  assert.ok(frame.confidence > 0 && frame.confidence <= 1);
  assert.ok(frame.rms > 0);
});

test('sampleFrame returns null on silence (nothing to transcribe)', () => {
  const frame = sampleFrame({ buf: new Float32Array(N), sampleRate: SR, gate: 0.008, t: 0 });
  assert.equal(frame, null);
});

test('sampleFrame is deterministic for the same input', () => {
  const a = sampleFrame({ buf: sineBuf(220), sampleRate: SR, gate: 0.008, t: 2 });
  const b = sampleFrame({ buf: sineBuf(220), sampleRate: SR, gate: 0.008, t: 2 });
  assert.deepEqual(a, b);
});

test('sampleFrame passes a custom fmin/fmax range through to yin', () => {
  const frame = sampleFrame({ buf: sineBuf(1200), sampleRate: SR, fmin: 800, fmax: 2000, gate: 0.008, t: 0 });
  assert.ok(frame, 'a tone inside a custom fmin/fmax range must still be detected');
  assert.ok(Math.abs(frame.midi - (69 + 12 * Math.log2(1200 / 440))) < 0.5);
});

// ---- createRecorder re-entrancy: a double-tapped Listen button calls
// start() again while the first call's openMic() is still pending (nothing
// in the DOM handler disables the button across that await). Before this
// fix each start() call awaited openMic independently and then unconditionally
// created its own setInterval, so the second call's timer silently replaced
// the first in the closure -- the FIRST interval was never cleared by
// anything and kept polling (and growing `frames`) forever, including after
// stop()/the panel closing.
function fakeApi({ openMic }) {
  let tickCount = 0;
  const api = {
    instrument: () => null,
    openMic,
    analysers: () => { tickCount++; return { time: null }; }, // time:null short-circuits tick() before it needs a real analyser
    audio: () => null,
    gates: () => ({ pitch: 0.008 }),
    now: () => 0,
  };
  return { api, ticks: () => tickCount };
}

function pendingOpenMic() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { openMic: () => promise, resolve: () => resolve() };
}

test('a second start() call while openMic() is still pending cannot orphan a polling interval', async () => {
  const pending = pendingOpenMic();
  const { api, ticks } = fakeApi({ openMic: pending.openMic });
  const rec = createRecorder(api, { intervalMs: 5 });

  rec.start(); // first Listen tap -- fire-and-forget, still awaiting openMic
  const second = rec.start(); // second Listen tap before the first openMic() resolved
  pending.resolve();
  await second;

  assert.equal(rec.listening, true, 'once openMic resolves, the recorder must be listening');
  const ticksAtStop = ticks();
  rec.stop(); // must clear every interval either start() call could have created
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ticks(), ticksAtStop, 'stop() left an interval from an earlier start() call still polling');
});

test('stop() called while start() is still awaiting openMic prevents the interval from ever starting', async () => {
  const pending = pendingOpenMic();
  const { api, ticks } = fakeApi({ openMic: pending.openMic });
  const rec = createRecorder(api, { intervalMs: 5 });

  const started = rec.start();
  rec.stop();
  pending.resolve();
  await started;

  assert.equal(rec.listening, false, 'stop() during a pending start must leave the recorder stopped once openMic resolves');
  const ticksAtStop = ticks();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ticks(), ticksAtStop, 'openMic resolving after stop() must not start the interval');
});
