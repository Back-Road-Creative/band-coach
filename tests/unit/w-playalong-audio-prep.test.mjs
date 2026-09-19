import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixToMono, formatTime, makeCancellableProgress, AnalysisCancelledError } from '../../src/ui/playalong/audio-prep.js';

test('mixToMono averages multiple channels sample-by-sample', () => {
  const left = new Float32Array([1, 0, -1, 0.5]);
  const right = new Float32Array([-1, 0, 1, 0.5]);
  const mono = mixToMono([left, right]);
  assert.equal(mono.length, 4);
  assert.deepEqual(Array.from(mono), [0, 0, 0, 0.5]);
});

test('mixToMono with a single channel returns an equivalent (not necessarily identical) buffer', () => {
  const only = new Float32Array([0.25, -0.75, 1]);
  const mono = mixToMono([only]);
  assert.deepEqual(Array.from(mono), [0.25, -0.75, 1]);
});

test('mixToMono throws on no channels', () => {
  assert.throws(() => mixToMono([]));
});

test('formatTime renders minutes:seconds, zero-padded', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(600), '10:00');
});

test('formatTime handles fractional and negative-ish input defensively', () => {
  assert.equal(formatTime(59.9), '0:59');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(NaN), '0:00');
});

test('makeCancellableProgress passes progress through until cancelled', () => {
  const seen = [];
  let cancelled = false;
  const wrapped = makeCancellableProgress((p) => seen.push(p), () => cancelled);
  wrapped(0);
  wrapped(0.5);
  assert.deepEqual(seen, [0, 0.5]);
  cancelled = true;
  assert.throws(() => wrapped(0.6), AnalysisCancelledError);
  assert.deepEqual(seen, [0, 0.5]);
});
