import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/intonation.js';

test('determinism, choice invariants, cents sign/ramp, and check()', () => {
  assert.deepEqual(make(2, 3), make(2, 3));
  let last = Infinity;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    let sawNonzero = false;
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.ok(q.choices.includes(q.answer));
      assert.equal(q.play[0].cents, 0);
      if (q.answer === 'sharp') assert.ok(q.play[1].cents > 0);
      if (q.answer === 'flat') assert.ok(q.play[1].cents < 0);
      if (q.answer === 'same') assert.equal(q.play[1].cents, 0);
      if (q.play[1].cents !== 0 && !sawNonzero) {
        assert.ok(Math.abs(q.play[1].cents) <= last, `level ${level} regressed`);
        last = Math.abs(q.play[1].cents);
        sawNonzero = true;
      }
    }
  }
  const q = make(1, 0);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, ['sharp', 'flat', 'same'].find((d) => d !== q.answer)).ok, false);
});
