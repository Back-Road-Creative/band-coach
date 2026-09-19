import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/intonation.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(2, 3), make(2, 3));
});

for (let level = 1; level <= LEVEL_COUNT; level++) {
  test(`level ${level} - answer is among choices, no duplicate choices`, () => {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.ok(q.choices.includes(q.answer));
    }
  });
}

test('level ramp is monotonic - the cents tolerance only shrinks (harder) as level rises', () => {
  const centsFor = (level) => {
    const q = make(level, 1); // seed 1 happens to be a non-"same" direction at every level tested
    return Math.abs(q.play[1].cents);
  };
  let last = Infinity;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 5; seed++) {
      const q = make(level, seed);
      if (q.play[1].cents !== 0) {
        assert.ok(Math.abs(q.play[1].cents) <= last, `level ${level} regressed`);
        last = Math.abs(q.play[1].cents);
        break;
      }
    }
  }
});

test('first tone always carries 0 cents; second carries the signed offset matching the answer', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 10; seed++) {
      const q = make(level, seed);
      assert.equal(q.play[0].cents, 0);
      if (q.answer === 'sharp') assert.ok(q.play[1].cents > 0);
      if (q.answer === 'flat') assert.ok(q.play[1].cents < 0);
      if (q.answer === 'same') assert.equal(q.play[1].cents, 0);
    }
  }
});

test('check(): correct direction is ok, wrong is not', () => {
  const q = make(1, 0);
  assert.equal(check(q, q.answer).ok, true);
  const wrong = ['sharp', 'flat', 'same'].find((d) => d !== q.answer);
  assert.equal(check(q, wrong).ok, false);
});
