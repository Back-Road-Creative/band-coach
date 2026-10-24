// src/instruments/how/keyboard.js: the one key geometry the practice canvas
// (drawKeys in src/app.js) and the How-to-play diagram both draw from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyLayout, keyboardRows, isWhiteKey } from '../../src/instruments/how/keyboard.js';
import kbd from '../../src/instruments/kbd.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);

test('keyLayout: 7 whites and 5 blacks in an octave, black keys sit on the white seams', () => {
  const L = keyLayout(0, 0, 320, 80, 48, 59);
  assert.equal(L.whites.length, 7); assert.equal(L.blacks.length, 5);
  assert.equal(isWhiteKey(60), true); assert.equal(isWhiteKey(61), false);
  near(L.kw, 320 / 7);
  for (const b of L.blacks) {
    const w = L.whites.find(x => x.m === b.m - 1);
    near(b.x, w.x + 0.68 * L.kw); near(b.w, 0.64 * L.kw); near(b.h, 0.62 * 80);
  }
});

test('keyLayout: white-key labels sit below the black keys at phone, desktop and large text', () => {
  for (const [w, h, lo, hi, ts] of [[660.5, 81.27, 60, 72, 1], [660.5, 81.27, 48, 59, 1], [1200, 180, 60, 72, 1], [660.5, 81.27, 60, 72, 2]]) {
    const L = keyLayout(0, 0, w, h, lo, hi, ts);
    for (const k of L.whites) {
      assert.ok(k.labelY - L.labelPx >= L.blackBottom - 1e-9, `label top ${k.labelY - L.labelPx} under black bottom ${L.blackBottom} at ${w}x${h}`);
      assert.ok(k.labelY <= h + 1e-9);
    }
  }
});

test('keyboardRows: middle C splits the hands', () => {
  assert.deepEqual(keyboardRows(kbd.range).map(r => [r.lo, r.hi]), [[48, 59], [60, 72]]);
});
