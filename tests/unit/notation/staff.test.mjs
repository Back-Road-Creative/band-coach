import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffPosition, ledgerLines, needsAccidental } from '../../../src/notation/staff.js';

test('staffPosition: bottom-line landmark notes are position 0 in each clef', () => {
  assert.equal(staffPosition({ letter: 'E', octave: 4 }, 'treble'), 0);
  assert.equal(staffPosition({ letter: 'G', octave: 2 }, 'bass'), 0);
  assert.equal(staffPosition({ letter: 'F', octave: 3 }, 'alto'), 0);
  assert.equal(staffPosition({ letter: 'D', octave: 3 }, 'tenor'), 0);
});

test('staffPosition: top line is 8 steps above the bottom line', () => {
  assert.equal(staffPosition({ letter: 'F', octave: 5 }, 'treble'), 8);
  assert.equal(staffPosition({ letter: 'A', octave: 3 }, 'bass'), 8);
});

test('ledgerLines: middle C needs one ledger line, in treble below and bass above', () => {
  const middleCTreble = staffPosition({ letter: 'C', octave: 4 }, 'treble');
  const middleCBass = staffPosition({ letter: 'C', octave: 4 }, 'bass');
  assert.deepEqual(ledgerLines(middleCTreble), [middleCTreble]);
  assert.deepEqual(ledgerLines(middleCBass), [middleCBass]);
});

test('ledgerLines: notes inside the staff need none', () => {
  assert.deepEqual(ledgerLines(0), []);
  assert.deepEqual(ledgerLines(4), []);
  assert.deepEqual(ledgerLines(8), []);
});

test('ledgerLines: a note just off the staff in a space needs no extra line', () => {
  // D4 in treble: one step below the bottom line (a space), no ledger line yet.
  const d4 = staffPosition({ letter: 'D', octave: 4 }, 'treble');
  assert.equal(d4, -1);
  assert.deepEqual(ledgerLines(d4), []);
});

test('ledgerLines: stacks lines for notes further off the staff', () => {
  const a3 = staffPosition({ letter: 'A', octave: 3 }, 'treble'); // -4
  assert.deepEqual(ledgerLines(a3), [-2, -4]);
});

test('needsAccidental: shown when the note differs from the key signature', () => {
  const bar = {};
  // F# is F major's default (Bb key, F is untouched -> F natural is default);
  // an F# note needs an accidental the first time.
  const note = { letter: 'F', accidental: '#', octave: 4 };
  assert.equal(needsAccidental(note, 'F', bar), true);
});

test('needsAccidental: remembered for the rest of the bar', () => {
  const bar = {};
  const note = { letter: 'F', accidental: '#', octave: 4 };
  assert.equal(needsAccidental(note, 'F', bar), true);
  assert.equal(needsAccidental(note, 'F', bar), false, 'same pitch again in the bar needs no repeat');
});

test('needsAccidental: a natural cancels a previously-shown accidental', () => {
  const bar = {};
  const sharped = { letter: 'F', accidental: '#', octave: 4 };
  const natural = { letter: 'F', accidental: '', octave: 4 };
  assert.equal(needsAccidental(sharped, 'F', bar), true);
  assert.equal(needsAccidental(natural, 'F', bar), true, 'natural must be shown to cancel');
});

test('needsAccidental: matches the key signature by default, no accidental shown', () => {
  const bar = {};
  const fSharpInGMajor = { letter: 'F', accidental: '#', octave: 4 };
  assert.equal(needsAccidental(fSharpInGMajor, 'G', bar), false);
});

test('needsAccidental: a different octave of the same letter is independent', () => {
  const bar = {};
  const note4 = { letter: 'F', accidental: '#', octave: 4 };
  const note5 = { letter: 'F', accidental: '#', octave: 5 };
  assert.equal(needsAccidental(note4, 'F', bar), true);
  assert.equal(needsAccidental(note5, 'F', bar), true, 'a different octave needs its own accidental');
});
