import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteName, pitchClass, chromaticRange } from '../../src/ui/fingerings/notes.js';

test('noteName matches the app\'s own spelling convention', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C♯4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(0), 'C-1');
});

test('pitchClass wraps into 0-11', () => {
  assert.equal(pitchClass(60), 0);
  assert.equal(pitchClass(61), 1);
  assert.equal(pitchClass(-1), 11);
});

test('chromaticRange lists every semitone inclusive', () => {
  assert.deepEqual(chromaticRange(60, 64), [60, 61, 62, 63, 64]);
  assert.deepEqual(chromaticRange(60, 60), [60]);
});
