import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ascendingMidis, chordMidis } from '../../src/ui/theory/scale-run.js';

test('ascendingMidis walks a major scale up to the octave', () => {
  assert.deepEqual(ascendingMidis(60, 'major'), [60, 62, 64, 65, 67, 69, 71, 72]);
});

test('ascendingMidis walks natural minor', () => {
  assert.deepEqual(ascendingMidis(60, 'natural_minor'), [60, 62, 63, 65, 67, 68, 70, 72]);
});

test('ascendingMidis throws on an unknown scale type', () => {
  assert.throws(() => ascendingMidis(60, 'not-a-scale'));
});

test('chordMidis stacks a major triad ascending above the root', () => {
  // C major: pitch classes 0, 4, 7; root C at midi 60.
  assert.deepEqual(chordMidis(60, 0, [0, 4, 7]), [60, 64, 67]);
});

test('chordMidis handles a root that is not pitch class 0', () => {
  // G major: root G (pc 7) midi 67; pitch classes 7, 11, 2.
  assert.deepEqual(chordMidis(67, 7, [7, 11, 2]), [67, 71, 74]);
});
