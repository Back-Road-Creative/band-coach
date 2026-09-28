import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteName, chromaticRange } from '../../src/ui/fingerings/notes.js';

test('noteName matches the app\'s own spelling convention', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C♯4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(0), 'C-1');
});

test('chromaticRange lists every semitone inclusive', () => {
  assert.deepEqual(chromaticRange(60, 64), [60, 61, 62, 63, 64]);
  assert.deepEqual(chromaticRange(60, 60), [60]);
});
