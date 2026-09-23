import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameFor, LETTERS_MIXED, setNoteNaming, getNoteNaming, name } from '../../src/core/note-names.js';

test('default (letters, mixed) reproduces today\'s NAMES table exactly', () => {
  const expected = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  assert.deepEqual(LETTERS_MIXED, expected);
  for (let pc = 0; pc < 12; pc++) assert.equal(nameFor(pc, {}), expected[pc]);
  assert.equal(nameFor(60, { octave: true }), 'C4');
  assert.equal(nameFor(61, { octave: true }), 'C♯4');
});

test('german: B natural is H, B flat is B', () => {
  assert.equal(nameFor(11, { system: 'german' }), 'H');
  assert.equal(nameFor(10, { system: 'german' }), 'B');
  assert.equal(nameFor(10, { system: 'german', accidentals: 'sharps' }), 'A♯');
  assert.equal(nameFor(0, { system: 'german' }), 'C');
});

test('solfege fixed-do: Do..Si, including Fa♯ and Si♭', () => {
  assert.equal(nameFor(0, { system: 'solfege' }), 'Do');
  assert.equal(nameFor(6, { system: 'solfege' }), 'Fa♯');
  assert.equal(nameFor(10, { system: 'solfege' }), 'Si♭');
  assert.equal(nameFor(11, { system: 'solfege' }), 'Si');
  assert.equal(nameFor(2, { system: 'solfege' }), 'Re');
});

test('unknown system/accidentals fall back to letters/mixed', () => {
  assert.equal(nameFor(1, { system: 'bogus', accidentals: 'nope' }), 'C♯');
});

test('setNoteNaming/getNoteNaming/name(): module-level pref drives name()', () => {
  setNoteNaming({ system: 'german', accidentals: 'mixed' });
  assert.deepEqual(getNoteNaming(), { system: 'german', accidentals: 'mixed' });
  assert.equal(name(11), 'H');
  assert.equal(name(60, true), 'C4');
  setNoteNaming({ system: 'letters', accidentals: 'mixed' });
});
