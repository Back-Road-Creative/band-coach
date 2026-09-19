import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/degrees.js';

test('determinism and choice invariants across levels', () => {
  assert.deepEqual(make(2, 7), make(2, 7));
  assert.notDeepEqual(make(2, 1), make(2, 2));
  let lastCount = 0;
  let lastPool = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      for (const deg of q.answer) assert.ok(q.choices.includes(deg));
    }
    const q0 = make(level, 0);
    assert.ok(q0.answer.length >= lastCount, `level ${level} note-count regressed`);
    assert.ok(q0.choices.length >= lastPool, `level ${level} pool regressed`);
    lastCount = q0.answer.length;
    lastPool = q0.choices.length;
  }
});

test('level 1 always stays in C; the cadence is I-IV-V-I', () => {
  for (let seed = 0; seed < 10; seed++) assert.match(make(1, seed).explain, /^Key: C major/);
  const chords = make(1, 3).play.slice(0, 4);
  assert.equal(chords.length, 4);
  chords.forEach((ev) => assert.equal(ev.midi.length, 3));
  assert.deepEqual(chords[0].midi, chords[3].midi);
});

test('check(): correct/wrong/short answers are graded correctly', () => {
  const two = make(4, 5);
  assert.equal(check(two, two.answer).ok, true);
  const one = make(1, 0);
  const wrong = one.answer.map(() => 'zzz');
  const result = check(one, wrong);
  assert.equal(result.ok, false);
  assert.equal(result.detail.wrong[0].expected, one.answer[0]);
  const three = make(5, 1);
  assert.equal(check(three, three.answer.slice(0, 1)).ok, false);
});
