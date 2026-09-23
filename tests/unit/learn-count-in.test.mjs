// countInTimes (src/ui/learn/count-in.js): the pure click-time scheduler
// behind the mic door's "1 2 3 4" count-in (plan §11.5.7, unit G1b). No
// AudioContext, no timers -- a bpm, a beat count and a start time in, an
// array of click times out, so the scheduling itself is testable with no
// browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countInTimes, clampBpm } from '../../src/ui/learn/count-in.js';

test('four clicks at 60bpm, one second apart, starting at startSec', () => {
  const times = countInTimes(60, 4, 10);
  assert.deepEqual(times, [10, 11, 12, 13]);
});

test('beats defaults to 4', () => {
  const times = countInTimes(90, undefined, 0);
  assert.equal(times.length, 4);
});

test('spacing follows bpm (90bpm -> 60/90s per beat)', () => {
  const times = countInTimes(90, 4, 0);
  const spb = 60 / 90;
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(times[i] - i * spb) < 1e-9, 'beat ' + i);
});

test('a non-positive or missing beats count returns no clicks', () => {
  assert.deepEqual(countInTimes(90, 0, 0), []);
  assert.deepEqual(countInTimes(90, -1, 0), []);
});

test('clampBpm clamps to the 40-200 range and defaults to 90', () => {
  assert.equal(clampBpm(90), 90);
  assert.equal(clampBpm(10), 40);
  assert.equal(clampBpm(500), 200);
  assert.equal(clampBpm(undefined), 90);
  assert.equal(clampBpm(NaN), 90);
  assert.equal(clampBpm('120'), 120);
});
