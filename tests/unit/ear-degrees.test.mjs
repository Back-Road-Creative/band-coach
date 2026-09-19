import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/degrees.js';

test('degrees: determinism - same level+seed gives the same question', () => {
  const a = make(2, 7);
  const b = make(2, 7);
  assert.deepEqual(a, b);
});

test('degrees: different seeds usually differ', () => {
  const a = make(2, 1);
  const b = make(2, 2);
  assert.notDeepEqual(a, b);
});

for (let level = 1; level <= LEVEL_COUNT; level++) {
  test(`degrees: level ${level} - answer is always among choices, choices have no duplicates`, () => {
    for (let seed = 0; seed < 20; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length, 'no duplicate choices');
      for (const deg of q.answer) {
        assert.ok(q.choices.includes(deg), `answer degree ${deg} missing from choices`);
      }
    }
  });
}

test('degrees: level ramp is monotonic - degree count per question never decreases', () => {
  let lastCount = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const q = make(level, 0);
    assert.ok(q.answer.length >= lastCount, `level ${level} regressed in degree count`);
    lastCount = q.answer.length;
  }
});

test('degrees: level ramp is monotonic - the pool of possible degrees never shrinks', () => {
  let lastSize = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const q = make(level, 0);
    assert.ok(q.choices.length >= lastSize, `level ${level} regressed in pool size`);
    lastSize = q.choices.length;
  }
});

test('degrees: level 1 always uses C (stays in one key)', () => {
  for (let seed = 0; seed < 10; seed++) {
    assert.match(make(1, seed).explain, /^Key: C major/);
  }
});

test('degrees: cadence is I-IV-V-I in the chosen key, played before the target note(s)', () => {
  const q = make(1, 3);
  const chordEvents = q.play.slice(0, 4);
  assert.equal(chordEvents.length, 4);
  chordEvents.forEach((ev) => assert.equal(ev.midi.length, 3));
  // I and the final I share the same triad.
  assert.deepEqual(chordEvents[0].midi, chordEvents[3].midi);
});

test('check(): correct answer in order is ok', () => {
  const q = make(4, 5); // two degrees
  const result = check(q, q.answer);
  assert.equal(result.ok, true);
});

test('check(): wrong degree is reported with index and expected value', () => {
  const q = make(1, 0);
  const wrongAnswer = q.answer.map(() => 'zzz');
  const result = check(q, wrongAnswer);
  assert.equal(result.ok, false);
  assert.equal(result.detail.wrong.length, q.answer.length);
  assert.equal(result.detail.wrong[0].expected, q.answer[0]);
});

test('check(): a short response is not ok even if the notes given are right', () => {
  const q = make(5, 1); // three degrees
  const result = check(q, q.answer.slice(0, 1));
  assert.equal(result.ok, false);
});
