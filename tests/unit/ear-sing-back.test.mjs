import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/sing-back.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(2, 4), make(2, 4));
});

test('choices are always empty (free response)', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
  }
});

test('level ramp is monotonic - note count never decreases', () => {
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const n = make(level, 0).answer.length;
    assert.ok(n >= last, `level ${level} regressed`);
    last = n;
  }
});

test('check(): exact pitch-class match is ok regardless of octave', () => {
  const q = make(1, 2);
  const sungAnOctaveDown = q.answer.map((m) => m - 12);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, sungAnOctaveDown).ok, true);
});

test('check(): wrong pitch class fails even in the right octave', () => {
  const q = make(1, 2);
  const wrong = q.answer.slice();
  wrong[0] += 1;
  assert.equal(check(q, wrong).ok, false);
});

test('check(): a short response is not ok', () => {
  const q = make(3, 1);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
});
