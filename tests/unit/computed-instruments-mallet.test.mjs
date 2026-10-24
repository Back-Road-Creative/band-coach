// src/instruments/how/mallet.js: the one bar geometry the practice canvas (drawBars in
// src/app.js) and the How-to-play diagram both draw from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barLayout, barRows, barLengthFactor } from '../../src/instruments/how/mallet.js';
import mallet from '../../src/instruments/mallet-percussion.js';

test('barLayout: 15 front naturals and 10 raised accidentals over C4-C6', () => {
  const L = barLayout(0, 0, 300, 100, 60, 84);
  assert.equal(L.bars.length, 15); assert.equal(L.raised.length, 10);
  assert.ok(L.bars.every(b => !b.black) && L.raised.every(b => b.black));
});

test('barLayout: each accidental sits behind (above) and centred on the seam after its natural', () => {
  const L = barLayout(0, 0, 300, 100, 60, 84);
  for (const a of L.raised) {
    const n = L.bars.find(b => b.m === a.m - 1);
    assert.ok(Math.abs((a.x + a.w / 2) - (n.x + n.w + L.slot * 0.07)) < 1e-9);
    assert.ok(a.y + a.h <= n.y + a.h * 0.5, 'raised bar mostly clear of the front bar');
    assert.ok(a.y < n.y);
    assert.ok(a.h < n.h);
  }
});

test('barLayout: bar length shrinks with pitch', () => {
  const L = barLayout(0, 0, 300, 100, 60, 84);
  for (let i = 1; i < L.bars.length; i++) assert.ok(L.bars[i].h < L.bars[i - 1].h);
  assert.equal(barLengthFactor(60, 60, 84), 1); assert.ok(Math.abs(barLengthFactor(84, 60, 84) - 0.62) < 1e-9);
});

test('barLayout: a second row keeps shrinking against the whole span', () => {
  const lo = barLayout(0, 0, 150, 100, 60, 71, 1, [60, 84]), hi = barLayout(0, 0, 150, 100, 72, 84, 1, [60, 84]);
  assert.ok(hi.bars[0].h < lo.bars[lo.bars.length - 1].h);
});

test('barRows: wide is one row, narrow splits at C5', () => {
  assert.deepEqual(barRows(mallet.range, false), [{ lo: 60, hi: 84 }]);
  assert.deepEqual(barRows(mallet.range, true), [{ lo: 60, hi: 71 }, { lo: 72, hi: 84 }]);
});
