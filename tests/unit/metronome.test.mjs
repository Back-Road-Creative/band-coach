import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBpm, beatTimes } from '../../src/core/metronome.js';

test('clampBpm: whole numbers inside 30..240, junk falls back to 80', () => {
  assert.equal(clampBpm(100), 100);
  assert.equal(clampBpm(300), 240);
  assert.equal(clampBpm(5), 30);
  assert.equal(clampBpm(90.6), 91);
  assert.equal(clampBpm('120'), 120);
  assert.equal(clampBpm(NaN), 80);
  assert.equal(clampBpm(Infinity), 80);
  assert.equal(clampBpm(undefined), 80);
  assert.equal(clampBpm('abc'), 80);
});

test('beatTimes: spacing is 60/bpm and beat 0 of each bar is accented', () => {
  const b = beatTimes(10, 120, 4, 9);
  assert.equal(b.length, 9);
  b.forEach((x, i) => {
    assert.ok(Math.abs(x.time - (10 + i * 0.5)) < 1e-9);
    assert.equal(x.beat, i % 4);
    assert.equal(x.accent, i % 4 === 0);
  });
});

test('beatTimes: firstBeat continues mid-bar; bad input yields an empty list', () => {
  const b = beatTimes(0, 60, 3, 3, 2);
  assert.deepEqual(b.map((x) => x.beat), [2, 0, 1]);
  assert.deepEqual(b.map((x) => x.accent), [false, true, false]);
  assert.deepEqual(beatTimes(0, 60, 4, 0), []);
});
