import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chord, diatonicChords, invert, nameChord, voicingsOnFretboard } from '../../src/core/theory/chords.js';
import { findKey } from '../../src/core/theory/keys.js';
import { byId } from '../../src/instruments/index.js';

function spelled(built) {
  return built.notes.map(n => n.letter + n.accidental).join(' ');
}

test('triads: correct spelling for maj/min/dim/aug/sus2/sus4', () => {
  assert.equal(spelled(chord('C', 'maj')), 'C E G');
  assert.equal(spelled(chord('C', 'min')), 'C Eb G');
  assert.equal(spelled(chord('C', 'dim')), 'C Eb Gb');
  assert.equal(spelled(chord('C', 'aug')), 'C E G#');
  assert.equal(spelled(chord('C', 'sus2')), 'C D G');
  assert.equal(spelled(chord('C', 'sus4')), 'C F G');
});

test('sevenths: correct spelling including the diminished seventh (Bbb, not A)', () => {
  assert.equal(spelled(chord('C', '7')), 'C E G Bb');
  assert.equal(spelled(chord('C', 'maj7')), 'C E G B');
  assert.equal(spelled(chord('C', 'm7')), 'C Eb G Bb');
  assert.equal(spelled(chord('C', 'm7b5')), 'C Eb Gb Bb');
  const dim7 = chord('C', 'dim7');
  assert.equal(spelled(dim7), 'C Eb Gb Bbb');
  assert.deepEqual(dim7.pitchClasses, [0, 3, 6, 9]);
});

test('chords built on a sharp root still use every-letter-once spelling', () => {
  assert.equal(spelled(chord('F#', 'maj')), 'F# A# C#');
  assert.equal(spelled(chord('F#', 'dim7')), 'F# A C Eb');
});

test('diatonic chords of C major: qualities and roman numerals', () => {
  const chords = diatonicChords(findKey('C'));
  assert.deepEqual(chords.map(c => c.numeral), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  assert.deepEqual(chords.map(c => c.quality), ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']);
  assert.equal(spelled(chords[4]), 'G B D'); // V
});

test('invert rotates the lowest tone', () => {
  const c = chord('C', 'maj');
  const first = invert(c, 1);
  assert.equal(spelled(first), 'E G C');
  const second = invert(c, 2);
  assert.equal(spelled(second), 'G C E');
});

test('nameChord finds the quality (and, for symmetric chords, more than one root)', () => {
  assert.deepEqual(nameChord([0, 4, 7]), [{ rootPc: 0, quality: 'maj' }]);
  const dim7Names = nameChord([0, 3, 6, 9]);
  assert.equal(dim7Names.length, 4); // C dim7 == Eb dim7 == Gb dim7 == A dim7
  assert.ok(dim7Names.every(n => n.quality === 'dim7'));
});

test('voicingsOnFretboard: standard open-position shapes appear near the top for C, G, D, Em, Am', () => {
  const tuning = byId.gtr.tuning; // [40,45,50,55,59,64] standard EADGBE
  const shapes = {
    'C-maj': [null, 3, 2, 0, 1, 0],
    'G-maj': [3, 2, 0, 0, 0, 3],
    'D-maj': [null, null, 0, 2, 3, 2],
    'E-min': [0, 2, 2, 0, 0, 0],
    'A-min': [null, 0, 2, 2, 1, 0],
  };
  for (const [label, expectedFrets] of Object.entries(shapes)) {
    const [root, quality] = label.split('-');
    const built = chord(root, quality);
    const voicings = voicingsOnFretboard(built, tuning, { maxFret: 5, maxSpan: 4 });
    const rank = voicings.findIndex(v => JSON.stringify(v.frets) === JSON.stringify(expectedFrets));
    assert.ok(rank >= 0, label + ' shape ' + JSON.stringify(expectedFrets) + ' should be a valid voicing at all');
    assert.ok(rank < 40, label + ' open shape ranked ' + rank + ' of ' + voicings.length + ', expected it near the top');
  }
});
