import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spellMidi, keyAccidentals } from '../../../src/notation/spell.js';

test('keyAccidentals: sharps in order for sharp keys', () => {
  assert.deepEqual(keyAccidentals('C'), []);
  assert.deepEqual(keyAccidentals('G').map((a) => a.letter), ['F']);
  assert.deepEqual(keyAccidentals('D').map((a) => a.letter), ['F', 'C']);
  assert.deepEqual(keyAccidentals('A').map((a) => a.letter), ['F', 'C', 'G']);
  assert.ok(keyAccidentals('D').every((a) => a.accidental === '#'));
});

test('keyAccidentals: flats in order for flat keys', () => {
  assert.deepEqual(keyAccidentals('F').map((a) => a.letter), ['B']);
  assert.deepEqual(keyAccidentals('Bb').map((a) => a.letter), ['B', 'E']);
  assert.deepEqual(keyAccidentals('Eb').map((a) => a.letter), ['B', 'E', 'A']);
  assert.ok(keyAccidentals('Eb').every((a) => a.accidental === 'b'));
});

test('keyAccidentals: minor keys map to their relative major', () => {
  assert.deepEqual(keyAccidentals('Am'), keyAccidentals('C'));
  assert.deepEqual(keyAccidentals('Em'), keyAccidentals('G'));
  assert.deepEqual(keyAccidentals('Dm'), keyAccidentals('F'));
});

test('spellMidi: midi 61 is C# in D major, Db in Ab major', () => {
  assert.deepEqual(spellMidi(61, 'D'), { letter: 'C', accidental: '#', octave: 4 });
  assert.deepEqual(spellMidi(61, 'Ab'), { letter: 'D', accidental: 'b', octave: 4 });
});

test('spellMidi: diatonic scale-tone spellings across several keys', () => {
  // G major (F#): scale degree 7 (pc 6) is F#, not Gb.
  assert.deepEqual(spellMidi(66, 'G'), { letter: 'F', accidental: '#', octave: 4 });
  // F major (Bb): scale degree 4 (pc 10) is Bb, not A#.
  assert.deepEqual(spellMidi(70, 'F'), { letter: 'B', accidental: 'b', octave: 4 });
  // E major (F#,C#,G#,D#): pc 8 is G#.
  assert.deepEqual(spellMidi(68, 'E'), { letter: 'G', accidental: '#', octave: 4 });
  // Db major (Bb,Eb,Ab,Db,Gb): pc 6 is Gb.
  assert.deepEqual(spellMidi(66, 'Db'), { letter: 'G', accidental: 'b', octave: 4 });
  // C major: pc 0 is C natural.
  assert.deepEqual(spellMidi(60, 'C'), { letter: 'C', accidental: '', octave: 4 });
  // B major (5 sharps): pc 11 is B natural (already a key-signature-free letter).
  assert.deepEqual(spellMidi(71, 'B'), { letter: 'B', accidental: '', octave: 4 });
});

test('spellMidi: a scale tone that is natural despite an altered key signature', () => {
  // G major has F# in the signature; an F-natural is a chromatic lowering, still spelled F.
  assert.deepEqual(spellMidi(65, 'G'), { letter: 'F', accidental: '', octave: 4 });
});

test('spellMidi: octave numbering follows middle C = 60 -> octave 4', () => {
  assert.equal(spellMidi(60, 'C').octave, 4);
  assert.equal(spellMidi(48, 'C').octave, 3);
  assert.equal(spellMidi(72, 'C').octave, 5);
});

test('spellMidi: B# in C# major sits one octave below the pitch-class octave', () => {
  // midi 60 (pc 0, "octave 4" by pitch class) is B#3, not B#4: B#3 sounds
  // as C4, so the letter's own octave must be one lower than the pc octave.
  assert.deepEqual(spellMidi(60, 'C#'), { letter: 'B', accidental: '#', octave: 3 });
  // and it carries through the minor-key alias.
  assert.deepEqual(spellMidi(60, 'A#m'), { letter: 'B', accidental: '#', octave: 3 });
});

test('spellMidi: Cb in Cb major sits one octave above the pitch-class octave', () => {
  // midi 59 (pc 11, "octave 3" by pitch class) is Cb4, not Cb3: Cb4 sounds
  // as B3, so the letter's own octave must be one higher than the pc octave.
  assert.deepEqual(spellMidi(59, 'Cb'), { letter: 'C', accidental: 'b', octave: 4 });
  assert.deepEqual(spellMidi(59, 'Abm'), { letter: 'C', accidental: 'b', octave: 4 });
});

test('spellMidi: ordinary spellings keep the pitch-class octave (regression)', () => {
  assert.deepEqual(spellMidi(60, 'C'), { letter: 'C', accidental: '', octave: 4 });
  assert.deepEqual(spellMidi(61, 'Db'), { letter: 'D', accidental: 'b', octave: 4 });
  assert.deepEqual(spellMidi(71, 'G'), { letter: 'B', accidental: '', octave: 4 });
});
