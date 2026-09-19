import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/rhythm-dictation.js';

const BAR_TICKS = 480 * 4;

test('determinism, free-response shape, bar count, and onset validity', () => {
  assert.deepEqual(make(2, 3), make(2, 3));
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
    const bars = level <= 3 ? 1 : 2;
    for (let seed = 0; seed < 10; seed++) {
      const onsets = make(level, seed).answer;
      assert.ok(onsets.length > 0);
      onsets.forEach((o) => {
        assert.equal(Number.isInteger(o), true);
        assert.ok(o >= 0 && o < BAR_TICKS * bars);
      });
    }
  }
});

test('level ramp is monotonic - bar count and finest note value both only get harder', () => {
  const barsFor = (level) => (level <= 3 ? 1 : 2);
  const smallestUsed = (level) => {
    let min = Infinity;
    for (let seed = 0; seed < 15; seed++) {
      const onsets = make(level, seed).answer;
      for (let i = 1; i < onsets.length; i++) min = Math.min(min, onsets[i] - onsets[i - 1]);
    }
    return min;
  };
  let lastBars = 0;
  let lastSmallest = Infinity;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.ok(barsFor(level) >= lastBars);
    lastBars = barsFor(level);
    const s = smallestUsed(level);
    assert.ok(s <= lastSmallest, `level ${level} regressed`);
    lastSmallest = s;
  }
});

test('check(): exact, tolerant, out-of-tolerance and short onset lists are graded correctly', () => {
  const q = make(2, 1);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, q.answer.map((t) => t + 20)).ok, true);
  assert.equal(check(q, q.answer.map((t) => t + 100)).ok, false);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
});
