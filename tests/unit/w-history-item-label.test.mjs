import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemLabel } from '../../src/ui/history/item-label.js';

test('note items name themselves from MIDI (matches app.js nname)', () => {
  assert.equal(itemLabel('n60'), 'C4');
  assert.equal(itemLabel('n61'), 'C♯4');
  assert.equal(itemLabel('n48'), 'C3');
});

test('pitch-class items name themselves without an octave', () => {
  assert.equal(itemLabel('p0'), 'C (any octave)');
  assert.equal(itemLabel('p9'), 'A (any octave)');
});

test('harmonica items name their direction and hole', () => {
  assert.equal(itemLabel('hb4'), 'Blow hole 4');
  assert.equal(itemLabel('hd10'), 'Draw hole 10');
});

test('shapes needing per-instrument context are refused, not guessed', () => {
  assert.equal(itemLabel('s3f2'), null);
  assert.equal(itemLabel('w62'), null);
  assert.equal(itemLabel('v4'), null);
  assert.equal(itemLabel('cAm'), null);
});

test('garbage input never throws', () => {
  assert.equal(itemLabel(''), null);
  assert.equal(itemLabel(null), null);
  assert.equal(itemLabel('n'), null);
  assert.equal(itemLabel('hx4'), null);
});
