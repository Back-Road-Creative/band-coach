// src/song/import-common.js: the pure helpers and constants the song importers
// and export-abc.js share. A wrong value here shifts every imported note, so
// the tables and both helpers are pinned directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STEP_PC, SHARP_ORDER, IMPORT_DEFAULT_BPM, midiFromStep, num } from '../../src/song/import-common.js';

test('STEP_PC maps each natural letter to its pitch class', () => {
  assert.deepEqual(STEP_PC, { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
});

test('SHARP_ORDER is the circle-of-fifths order sharps are added in', () => {
  assert.deepEqual(SHARP_ORDER, ['F', 'C', 'G', 'D', 'A', 'E', 'B']);
});

test('the fallback tempo is 120 bpm', () => {
  assert.equal(IMPORT_DEFAULT_BPM, 120);
});

test('midiFromStep puts middle C at 60 and A4 at 69', () => {
  assert.equal(midiFromStep('C', 4, 0), 60);
  assert.equal(midiFromStep('A', 4, 0), 69);
  assert.equal(midiFromStep('C', -1, 0), 0);
  assert.equal(midiFromStep('G', 9, 0), 127);
});

test('midiFromStep applies the accidental in semitones', () => {
  assert.equal(midiFromStep('F', 4, 1), 66);
  assert.equal(midiFromStep('B', 3, -1), 58);
  assert.equal(midiFromStep('C', 4, 2), 62);
});

test('midiFromStep gives NaN for a letter it does not know, never a quiet wrong note', () => {
  assert.ok(Number.isNaN(midiFromStep('H', 4, 0)));
});

test('num returns the fallback for missing or empty input', () => {
  assert.equal(num(undefined, 7), 7);
  assert.equal(num(null, 7), 7);
  assert.equal(num('', 7), 7);
});

test('num parses numeric text and numbers', () => {
  assert.equal(num('96', 0), 96);
  assert.equal(num('-3', 0), -3);
  assert.equal(num('2.5', 0), 2.5);
  assert.equal(num(12, 0), 12);
  assert.equal(num('0', 9), 0, 'zero is a real value, not a missing one');
});

test('num returns the fallback for text that is not a finite number', () => {
  assert.equal(num('abc', 5), 5);
  assert.equal(num('Infinity', 5), 5);
  assert.equal(num(NaN, 5), 5);
});
