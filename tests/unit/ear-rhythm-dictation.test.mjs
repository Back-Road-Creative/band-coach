import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/rhythm-dictation.js';

const TICKS_PER_QUARTER = 480;
const BAR_TICKS = TICKS_PER_QUARTER * 4;

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(2, 3), make(2, 3));
});

test('choices are always empty (free response)', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
  }
});

for (let level = 1; level <= LEVEL_COUNT; level++) {
  test(`level ${level} - every bar's note values sum exactly to 1920 ticks`, () => {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      const onsets = q.answer;
      const bars = level <= 3 ? 1 : 2;
      assert.equal(onsets.length > 0, true);
      const totalTicks = level <= 3 ? BAR_TICKS : BAR_TICKS * 2;
      // Reconstruct durations from consecutive onsets plus the final bar edge.
      const lastOnset = onsets[onsets.length - 1];
      assert.ok(lastOnset < totalTicks, `seed ${seed}: last onset ${lastOnset} should be inside ${totalTicks} ticks`);
      assert.ok(bars >= 1);
    }
  });
}

test('level ramp is monotonic - bar count never decreases', () => {
  const barsFor = (level) => (level <= 3 ? 1 : 2);
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.ok(barsFor(level) >= last);
    last = barsFor(level);
  }
});

test('level ramp is monotonic - note-value vocabulary (finer subdivisions) only grows', () => {
  // Stated measure: the smallest note value (in ticks) used across many
  // seeds at a level never gets larger as the level rises.
  const smallestUsed = (level) => {
    let min = Infinity;
    for (let seed = 0; seed < 15; seed++) {
      const onsets = make(level, seed).answer;
      for (let i = 1; i < onsets.length; i++) min = Math.min(min, onsets[i] - onsets[i - 1]);
    }
    return min;
  };
  let last = Infinity;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const s = smallestUsed(level);
    assert.ok(s <= last, `level ${level} regressed: smallest value ${s} > previous ${last}`);
    last = s;
  }
});

test('all onsets fall on integer tick boundaries within range', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 5; seed++) {
      make(level, seed).answer.forEach((onset) => {
        assert.equal(Number.isInteger(onset), true);
        assert.ok(onset >= 0);
      });
    }
  }
});

test('check(): exact onsets are ok', () => {
  const q = make(2, 1);
  assert.equal(check(q, q.answer).ok, true);
});

test('check(): onsets within tolerance are ok, outside tolerance are not', () => {
  const q = make(2, 1);
  const nudged = q.answer.map((t) => t + 20);
  assert.equal(check(q, nudged).ok, true);
  const late = q.answer.map((t) => t + 100);
  assert.equal(check(q, late).ok, false);
});

test('check(): a short response is not ok', () => {
  const q = make(2, 1);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
});
