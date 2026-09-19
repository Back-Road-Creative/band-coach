import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAudioTime, judgeTap, medianLatency } from '../../src/core/timing.js';

test('toAudioTime maps an event fired at the reference instant onto audioNow', () => {
  const audioTime = toAudioTime({ eventTimeStamp: 1000, perfNow: 1000, audioNow: 5 });
  assert.equal(audioTime, 5);
});

test('toAudioTime shifts by however far the event timeStamp is from the reference perfNow', () => {
  // event fired 50ms before the perf/audio reference sample was taken
  const audioTime = toAudioTime({ eventTimeStamp: 950, perfNow: 1000, audioNow: 5 });
  assert.ok(Math.abs(audioTime - 4.95) < 1e-9, `expected ~4.95, got ${audioTime}`);
});

test('judgeTap: an on-time tap is ok with a near-zero signed error', () => {
  const v = judgeTap({ tapTime: 2.01, beatTimes: [1, 2, 3], latencyMs: 0, windowMs: 50 });
  assert.equal(v.beatIndex, 1);
  assert.ok(v.ok, 'expected on-time verdict');
  assert.ok(Math.abs(v.errorMs - 10) < 1e-6, `expected ~10ms, got ${v.errorMs}`);
});

test('judgeTap: an early tap outside the window is not ok and errorMs is negative', () => {
  const v = judgeTap({ tapTime: 1.9, beatTimes: [1, 2, 3], latencyMs: 0, windowMs: 50 });
  assert.equal(v.beatIndex, 1);
  assert.equal(v.ok, false);
  assert.ok(v.errorMs < 0, `expected a negative (early) errorMs, got ${v.errorMs}`);
});

test('judgeTap: a late tap outside the window is not ok and errorMs is positive', () => {
  const v = judgeTap({ tapTime: 2.2, beatTimes: [1, 2, 3], latencyMs: 0, windowMs: 50 });
  assert.equal(v.beatIndex, 1);
  assert.equal(v.ok, false);
  assert.ok(v.errorMs > 0, `expected a positive (late) errorMs, got ${v.errorMs}`);
});

test('judgeTap: latencyMs shifts a tap that looks late back to on-time', () => {
  // the tap physically lands 120ms after beat 2, but 120ms of that is output latency
  const v = judgeTap({ tapTime: 2.12, beatTimes: [1, 2, 3], latencyMs: 120, windowMs: 50 });
  assert.ok(v.ok, 'latency-corrected tap should be judged on-time');
  assert.ok(Math.abs(v.errorMs) < 1e-6, `expected ~0ms after correction, got ${v.errorMs}`);
});

test('judgeTap: the same raw tap is judged late with no latency correction', () => {
  const v = judgeTap({ tapTime: 2.12, beatTimes: [1, 2, 3], latencyMs: 0, windowMs: 50 });
  assert.equal(v.ok, false);
  assert.ok(v.errorMs > 0);
});

test('judgeTap: no beats to compare against is reported, not thrown', () => {
  const v = judgeTap({ tapTime: 1, beatTimes: [], latencyMs: 0, windowMs: 50 });
  assert.equal(v.ok, false);
  assert.equal(v.beatIndex, -1);
  assert.equal(v.errorMs, null);
});

test('medianLatency: the median of a clean sample set', () => {
  assert.equal(medianLatency([90, 100, 110]), 100);
  assert.equal(medianLatency([80, 100, 120, 140]), 110);
});

test('medianLatency: robust to one wild outlier', () => {
  const med = medianLatency([100, 105, 110, 10000]);
  assert.ok(Math.abs(med - 107.5) < 1e-9, `expected ~107.5, got ${med}`);
});

test('medianLatency: clamps to the 0..300ms range', () => {
  assert.equal(medianLatency([-500, -400, -300]), 0);
  assert.equal(medianLatency([1000, 2000, 3000]), 300);
});

test('medianLatency: empty input is zero', () => {
  assert.equal(medianLatency([]), 0);
});
