import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/sing-back.js';

test('determinism, free-response shape, and a monotonic note-count ramp', () => {
  assert.deepEqual(make(2, 4), make(2, 4));
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
    const n = make(level, 0).answer.length;
    assert.ok(n >= last, `level ${level} regressed`);
    last = n;
  }
});

test('check(): octave-folded pitch-class matching, wrong notes, and short responses', () => {
  const q = make(1, 2);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, q.answer.map((m) => m - 12)).ok, true); // any octave
  const wrong = q.answer.slice();
  wrong[0] += 1;
  assert.equal(check(q, wrong).ok, false);
  const short = make(3, 1);
  assert.equal(check(short, short.answer.slice(0, 1)).ok, false);
});
