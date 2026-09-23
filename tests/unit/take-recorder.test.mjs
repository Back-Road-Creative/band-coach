// Pure logic test for src/audio/take-recorder.js: PCM chunk accumulation for
// the play-along panel's "Record a take" control (I3, "duet with yourself").
// No DOM, no AudioContext — plain typed-array chunks in, one Float32Array
// out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTakeAccumulator, DEFAULT_MAX_DURATION_SEC } from '../../src/audio/take-recorder.js';

test('accumulates chunks into one contiguous Float32Array, in order', () => {
  const acc = createTakeAccumulator(1000);
  acc.push(new Float32Array([1, 2, 3]));
  acc.push(new Float32Array([4, 5]));
  const { pcm, sampleRate, duration } = acc.finish();
  assert.deepEqual(Array.from(pcm), [1, 2, 3, 4, 5]);
  assert.equal(sampleRate, 1000);
  assert.equal(duration, 5 / 1000);
});

test('reports duration and sample count as pushes happen', () => {
  const acc = createTakeAccumulator(100);
  assert.equal(acc.durationSec, 0);
  acc.push(new Float32Array(50));
  assert.equal(acc.sampleCount, 50);
  assert.equal(acc.durationSec, 0.5);
  acc.push(new Float32Array(50));
  assert.equal(acc.durationSec, 1);
});

test('caps total length at maxDurationSec, truncating the chunk that crosses it', () => {
  const acc = createTakeAccumulator(10, { maxDurationSec: 1 }); // 10 samples max
  const ok1 = acc.push(new Float32Array(6).fill(1));
  assert.equal(ok1, true, 'still room after the first push');
  const ok2 = acc.push(new Float32Array(6).fill(2)); // would be 12 samples; cap is 10
  assert.equal(ok2, false, 'cap reached on this push');
  assert.equal(acc.isFull, true);
  const { pcm, duration } = acc.finish();
  assert.equal(pcm.length, 10);
  assert.deepEqual(Array.from(pcm), [1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(duration, 1);
});

test('a push after the cap is reached is a no-op', () => {
  const acc = createTakeAccumulator(10, { maxDurationSec: 1 });
  acc.push(new Float32Array(10).fill(1));
  assert.equal(acc.isFull, true);
  const ok = acc.push(new Float32Array(5).fill(9));
  assert.equal(ok, false);
  assert.equal(acc.finish().pcm.length, 10);
});

test('an empty or missing chunk changes nothing', () => {
  const acc = createTakeAccumulator(100);
  acc.push(new Float32Array(0));
  acc.push(null);
  acc.push(undefined);
  assert.equal(acc.sampleCount, 0);
  assert.equal(acc.finish().pcm.length, 0);
});

test('defaults the cap to 5 minutes when maxDurationSec is not given', () => {
  const sampleRate = 8000;
  assert.equal(DEFAULT_MAX_DURATION_SEC, 300);
  const acc = createTakeAccumulator(sampleRate);
  const fiveMinutesOfSamples = 300 * sampleRate;
  const ok = acc.push(new Float32Array(fiveMinutesOfSamples + 100));
  assert.equal(ok, false, 'a chunk longer than 5 minutes trips the default cap');
  assert.equal(acc.finish().pcm.length, fiveMinutesOfSamples);
});

test('rejects a non-positive sampleRate', () => {
  assert.throws(() => createTakeAccumulator(0));
  assert.throws(() => createTakeAccumulator(-1));
});

test('accepts a plain array-like chunk (not just Float32Array)', () => {
  const acc = createTakeAccumulator(1000);
  acc.push([1, 2, 3]);
  assert.deepEqual(Array.from(acc.finish().pcm), [1, 2, 3]);
});
