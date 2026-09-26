import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCKEYS, PCKEYS_UPPER, PCKEYS_LOWER, pckeysRowRange } from '../../src/core/pckeys.js';
import { HANDS_TOGETHER_EXERCISES } from '../../src/core/hands-together.js';

test('upper row: a..k map to C4 (60) up to C5 (72), unchanged from before this module existed', () => {
  assert.deepEqual(PCKEYS_UPPER, { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 });
});

test('lower row: z x c v b n m map to the seven naturals C3 (48) up to B3 (59), no sharps', () => {
  assert.deepEqual(PCKEYS_LOWER, { z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59 });
  // every value is a natural (white key): pitch class not in the sharp set
  const SHARP_PCS = [1, 3, 6, 8, 10];
  Object.values(PCKEYS_LOWER).forEach(m => assert.ok(!SHARP_PCS.includes(m % 12), `${m} should be a natural`));
});

test('no key is mapped twice across the two rows', () => {
  const upperKeys = Object.keys(PCKEYS_UPPER), lowerKeys = Object.keys(PCKEYS_LOWER);
  const overlap = upperKeys.filter(k => lowerKeys.includes(k));
  assert.deepEqual(overlap, []);
  assert.equal(Object.keys(PCKEYS).length, upperKeys.length + lowerKeys.length);
});

test('no MIDI note is mapped twice across the two rows', () => {
  const values = Object.values(PCKEYS);
  assert.equal(new Set(values).size, values.length);
});

test('the lower row covers every left-hand note the hands-together curriculum needs', () => {
  const lowerNotes = new Set(Object.values(PCKEYS_LOWER));
  HANDS_TOGETHER_EXERCISES.forEach(ex => assert.ok(lowerNotes.has(ex.lh.midi), `left-hand note ${ex.lh.midi} (${ex.name}) is reachable from the computer keys`));
});

test('pckeysRowRange reports the lowest and highest MIDI note a row reaches', () => {
  assert.deepEqual(pckeysRowRange(PCKEYS_UPPER), [60, 72]);
  assert.deepEqual(pckeysRowRange(PCKEYS_LOWER), [48, 59]);
});
