import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, modeIntervals, SCALE_FAMILIES, LEVEL_COUNT } from '../../src/core/ear/scales-modes.js';

test('determinism, choice invariants, and a monotonic family pool', () => {
  assert.deepEqual(make(3, 11), make(3, 11));
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.ok(q.choices.includes(q.answer));
    }
    const n = make(level, 0).choices.length;
    assert.ok(n >= last, `level ${level} regressed`);
    last = n;
  }
});

// Hand-checked values, per the brief.
test('C major, A harmonic minor, D dorian, E phrygian compute correctly', () => {
  const pcsOf = (intervals, tonicPc) => [...intervals, 12].map((iv) => (tonicPc + iv) % 12);
  assert.deepEqual(pcsOf(SCALE_FAMILIES.major.intervals, 0), [0, 2, 4, 5, 7, 9, 11, 0]); // C D E F G A B C
  assert.deepEqual(SCALE_FAMILIES.harmonic_minor.intervals, [0, 2, 3, 5, 7, 8, 11]);
  assert.deepEqual(pcsOf(SCALE_FAMILIES.harmonic_minor.intervals, 9), [9, 11, 0, 2, 4, 5, 8, 9]); // A B C D E F G# A
  assert.deepEqual(modeIntervals(1), [0, 2, 3, 5, 7, 9, 10]); // dorian
  assert.deepEqual(pcsOf(modeIntervals(1), 2), [2, 4, 5, 7, 9, 11, 0, 2]); // D E F G A B C D
  assert.deepEqual(modeIntervals(2), [0, 1, 3, 5, 7, 8, 10]); // phrygian
  assert.deepEqual(pcsOf(modeIntervals(2), 4), [4, 5, 7, 9, 11, 0, 2, 4]); // E F G A B C D E
});

test('melodic minor, pentatonics and blues are computed alterations/subsets', () => {
  assert.deepEqual(SCALE_FAMILIES.natural_minor.intervals, [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(SCALE_FAMILIES.melodic_minor.intervals, [0, 2, 3, 5, 7, 9, 11]);
  assert.deepEqual(SCALE_FAMILIES.major_pentatonic.intervals, [0, 2, 4, 7, 9]);
  assert.deepEqual(SCALE_FAMILIES.minor_pentatonic.intervals, [0, 3, 5, 7, 10]);
  assert.deepEqual(SCALE_FAMILIES.blues.intervals, [0, 3, 5, 6, 7, 10]);
});

test('check(): family-name and played-back-pitch-class responses both grade correctly', () => {
  const q = make(1, 4);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, 'not-a-family').ok, false);
  const heardMidi = q.scalePcs.map((pc) => 60 + pc);
  assert.equal(check(q, heardMidi).ok, true);
  const wrongMidi = heardMidi.slice();
  wrongMidi[1] += 1;
  assert.equal(check(q, wrongMidi).ok, false);
});
