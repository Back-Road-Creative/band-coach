import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardDiagramKeys } from '../../src/ui/theory/keyboard-diagram.js';

test('returns all 12 keys, 7 white and 5 black, ascending by x', () => {
  const keys = keyboardDiagramKeys([0, 4, 7]);
  assert.equal(keys.length, 12);
  assert.equal(keys.filter((k) => !k.isBlack).length, 7);
  assert.equal(keys.filter((k) => k.isBlack).length, 5);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i].x > keys[i - 1].x);
});

test('marks a major triad (C E G) active and leaves the rest inactive', () => {
  const keys = keyboardDiagramKeys([0, 4, 7]);
  const active = keys.filter((k) => k.active).map((k) => k.pc).sort((a, b) => a - b);
  assert.deepEqual(active, [0, 4, 7]);
});

test('normalises pitch classes outside 0-11', () => {
  const keys = keyboardDiagramKeys([12, -1]);
  const active = keys.filter((k) => k.active).map((k) => k.pc).sort((a, b) => a - b);
  assert.deepEqual(active, [0, 11]);
});

test('white keys carry their letter, black keys do not', () => {
  const keys = keyboardDiagramKeys([]);
  keys.filter((k) => !k.isBlack).forEach((k) => assert.equal(typeof k.letter, 'string'));
  keys.filter((k) => k.isBlack).forEach((k) => assert.equal(k.letter, null));
});
