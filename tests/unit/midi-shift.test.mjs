// F13: a MIDI keyboard with its octave or transpose button on plays every
// note the same distance off. midiShift reads the run of consecutive wrong
// MIDI notes and names the shared offset; midiShiftHint words it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiShift, midiShiftHint, SHIFT_RUN } from '../../src/core/wrong-note.js';
import { setLocale } from '../../src/core/i18n.js';

const run = (offsets) => offsets.map((d, k) => ({ heardMidi: 60 + k + d, targetMidi: 60 + k }));

test('four misses in a row at one nonzero offset name that offset', () => {
  assert.equal(SHIFT_RUN, 4);
  assert.equal(midiShift(run([12, 12, 12, 12])), 12);
  assert.equal(midiShift(run([-12, -12, -12, -12])), -12);
  assert.equal(midiShift(run([3, 2, 2, 2, 2])), 2, 'only the last four count');
});

test('fewer than four, mixed offsets, or nothing at all: no shift', () => {
  assert.equal(midiShift(run([12])), 0);
  assert.equal(midiShift(run([12, 12, 12])), 0);
  assert.equal(midiShift(run([12, 12, 2, 12])), 0);
  assert.equal(midiShift([]), 0);
  assert.equal(midiShift(null), 0);
});

test('the hint names the direction and the distance', () => {
  setLocale('en');
  assert.match(midiShiftHint(12), /an octave too high/);
  assert.match(midiShiftHint(-12), /an octave too low/);
  assert.match(midiShiftHint(2), /2 semitones too high/);
  assert.match(midiShiftHint(-1), /a semitone too low/);
  for (const d of [12, -12, 2, -1]) assert.match(midiShiftHint(d), /octave or transpose|transpose/);
  setLocale('es');
  assert.match(midiShiftHint(12), /una octava más agudas/);
  setLocale('en');
});
