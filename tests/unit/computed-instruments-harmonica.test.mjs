import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFor, holesFor } from '../../src/instruments/how/harmonica.js';

test('C harmonica: hole 1 blow is C4 and hole 10 blow is C7 (matches harp.js range 60-96)', () => {
  const layout = layoutFor(0);
  assert.equal(layout[0].blow, 60);
  assert.equal(layout[9].blow, 96);
});

test('C harmonica: hole 4 blow/draw is C5/D5', () => {
  const layout = layoutFor(0);
  assert.equal(layout[3].blow, 72);
  assert.equal(layout[3].draw, 74);
});

test('hole 1 has exactly one draw bend', () => {
  const layout = layoutFor(0);
  assert.equal(layout[0].bends.length, 1);
  assert.equal(layout[0].bends[0].action, 'draw');
});

test('hole 3 has exactly three draw bends (the famous three-bend hole)', () => {
  const layout = layoutFor(0);
  assert.equal(layout[2].bends.length, 3);
  assert.ok(layout[2].bends.every(b => b.action === 'draw'));
});

test('hole 5 has no usable bend (blow and draw are a semitone apart)', () => {
  const layout = layoutFor(0);
  assert.equal(layout[4].bends.length, 0);
});

test('hole 7 has no usable blow bend', () => {
  const layout = layoutFor(0);
  assert.equal(layout[6].bends.length, 0);
});

test('hole 8 has exactly one blow bend', () => {
  const layout = layoutFor(0);
  assert.equal(layout[7].bends.length, 1);
  assert.equal(layout[7].bends[0].action, 'blow');
});

test('transposing to key of D shifts every note up 2 semitones', () => {
  const c = layoutFor(0);
  const d = layoutFor(2);
  for (let i = 0; i < 10; i++) {
    assert.equal(d[i].blow, c[i].blow + 2);
    assert.equal(d[i].draw, c[i].draw + 2);
  }
});

test('holesFor finds the open blow option first, then bends, ranked easiest first', () => {
  const options = holesFor(60, 0); // C4: hole1 blow, open
  assert.equal(options[0].hole, 1);
  assert.equal(options[0].action, 'blow');
  assert.equal(options[0].difficulty, 'open');
});

test('holesFor finds a draw-bent note (hole 3, bent one semitone down from B4/71 to 70)', () => {
  const options = holesFor(70, 0);
  assert.ok(options.some(o => o.hole === 3 && o.action === 'draw' && o.semitonesBent === 1));
});

test('rejects an out-of-range key', () => {
  assert.throws(() => layoutFor(12));
  assert.throws(() => layoutFor(-1));
});
