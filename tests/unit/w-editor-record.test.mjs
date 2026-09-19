// Pure logic behind the "Record a tune" panel's mic sampling
// (src/ui/editor/record.js): turning one analyser read into a raw pitch
// frame transcribe() can consume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleFrame } from '../../src/ui/editor/record.js';

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
