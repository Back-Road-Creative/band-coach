import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, modeIntervals, SCALE_FAMILIES, LEVEL_COUNT } from '../../src/core/ear/scales-modes.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(3, 11), make(3, 11));
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

test('level ramp is monotonic - the family pool never shrinks', () => {
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const q = make(level, 0);
    assert.ok(q.choices.length >= last);
    last = q.choices.length;
  }
});

// Hand-checked values, per the brief.
test('C major computes to C D E F G A B C', () => {
  const family = SCALE_FAMILIES.major;
  const pcs = [...family.intervals, 12].map((iv) => (0 + iv) % 12);
  assert.deepEqual(pcs, [0, 2, 4, 5, 7, 9, 11, 0]);
});

test('A harmonic minor computes to A B C D E F G# A', () => {
  const family = SCALE_FAMILIES.harmonic_minor;
  assert.deepEqual(family.intervals, [0, 2, 3, 5, 7, 8, 11]);
  const tonicPc = 9; // A
  const pcs = [...family.intervals, 12].map((iv) => (tonicPc + iv) % 12);
  // A B C D E F G# A -> pitch classes 9,11,0,2,4,5,8,9
  assert.deepEqual(pcs, [9, 11, 0, 2, 4, 5, 8, 9]);
});

test('D dorian computes to D E F G A B C D', () => {
  const intervals = modeIntervals(1); // dorian
  assert.deepEqual(intervals, [0, 2, 3, 5, 7, 9, 10]);
  const tonicPc = 2; // D
  const pcs = [...intervals, 12].map((iv) => (tonicPc + iv) % 12);
  // D E F G A B C D -> 2,4,5,7,9,11,0,2
  assert.deepEqual(pcs, [2, 4, 5, 7, 9, 11, 0, 2]);
});

test('E phrygian computes to E F G A B C D E', () => {
  const intervals = modeIntervals(2); // phrygian
  assert.deepEqual(intervals, [0, 1, 3, 5, 7, 8, 10]);
  const tonicPc = 4; // E
  const pcs = [...intervals, 12].map((iv) => (tonicPc + iv) % 12);
  // E F G A B C D E -> 4,5,7,9,11,0,2,4
  assert.deepEqual(pcs, [4, 5, 7, 9, 11, 0, 2, 4]);
});

test('melodic minor is natural minor with a raised 6th and 7th', () => {
  const natural = SCALE_FAMILIES.natural_minor.intervals;
  const melodic = SCALE_FAMILIES.melodic_minor.intervals;
  assert.deepEqual(natural, [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(melodic, [0, 2, 3, 5, 7, 9, 11]);
});

test('major and minor pentatonics and blues are subsets/additions of the derived scales', () => {
  assert.deepEqual(SCALE_FAMILIES.major_pentatonic.intervals, [0, 2, 4, 7, 9]);
  assert.deepEqual(SCALE_FAMILIES.minor_pentatonic.intervals, [0, 3, 5, 7, 10]);
  assert.deepEqual(SCALE_FAMILIES.blues.intervals, [0, 3, 5, 6, 7, 10]);
});

test('check(): a family-name answer is graded correctly', () => {
  const q = make(1, 4);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, 'not-a-family').ok, false);
});

test('check(): a played-back pitch-class sequence is graded correctly', () => {
  const q = make(1, 4);
  const heardMidi = q.scalePcs.map((pc) => 60 + pc);
  assert.equal(check(q, heardMidi).ok, true);
  const wrongMidi = heardMidi.slice();
  wrongMidi[1] += 1;
  assert.equal(check(q, wrongMidi).ok, false);
});
