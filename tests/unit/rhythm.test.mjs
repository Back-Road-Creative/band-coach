import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TPQ, METRES, CELLS, buildPhrase, onsetsOf, validateBar, totalTicks } from '../../src/core/rhythm.js';

// ---- no-regression pin ----------------------------------------------------
// Extracted from src/app.js CELLS (line 45) and the bar-building math at
// src/app.js startBar()/buildLevelTask() ('bar' kind): onset time for a cell
// element at cumulative beat offset `b`, with onset fraction `o` from
// CELLS[id].on, is (b + o) * spb where spb = 60 / bpm and b advances by
// CELLS[id].b (beats) after each cell. At bpm=60, spb=1, so onset times in
// seconds equal onset times in beats. These are today's numbers for the ten
// original cells, played back to back in their MODS.rhy.levels order.
const OLD_CELLS_ORDER = ['q', 'ee', 'h', 'qr', 'ssss', 'dqe', 'ree', 'ess', 'sse', 'eqe'];
const PINNED_ONSETS = [0, 1, 1.5, 2, 5, 5.25, 5.5, 5.75, 6, 7.5, 8.5, 9, 9.5, 9.75, 10, 10.25, 10.5, 11, 11.5, 12.5];

test('the ten original 4/4 cells produce the same onset times as today (regression pin)', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: OLD_CELLS_ORDER });
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  assert.deepEqual(onsets, PINNED_ONSETS);
});

// ---- rests ------------------------------------------------------------
test('a rest produces no onset', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['q', 'hr', 'q'] });
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  assert.deepEqual(onsets, [0, 3]); // q at 0s, hr (2 beats) silent, q at 1+2=3s
});

test('a whole-bar rest produces no onsets at all', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['wr'] });
  assert.deepEqual(onsetsOf(phrase.events, { bpm: 60 }), []);
  assert.equal(validateBar(phrase.events, '4/4'), true);
});

// ---- ties ---------------------------------------------------------------
test('a tie across a beat produces one onset, not two', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['tqq', 'q', 'q'] }); // tqq = q + q(tied)
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  assert.deepEqual(onsets, [0, 2, 3]); // the tied second quarter of tqq produces no onset
});

test('a tie across the barline in a two-bar phrase produces no onset at the barline', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: [['q', 'q', 'q', 'q'], ['q~', 'q', 'q', 'q']] });
  assert.equal(validateBar(phrase.events.filter(e => e.bar === 0), '4/4'), true);
  assert.equal(validateBar(phrase.events.filter(e => e.bar === 1), '4/4'), true);
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  // bar1: onsets at 0,1,2,3; bar2 starts with q~ (tied, no onset) then q,q,q at 5,6,7 -- nothing at 4
  assert.deepEqual(onsets, [0, 1, 2, 3, 5, 6, 7]);
});

// ---- triplets -------------------------------------------------------------
test('an eighth-note triplet fits exactly in the space of one beat', () => {
  const cell = CELLS.et3;
  assert.equal(cell.reduce((s, e) => s + e.dur, 0), TPQ);
  const phrase = buildPhrase({ metre: '4/4', cells: ['et3', 'q', 'q', 'q'] });
  assert.equal(validateBar(phrase.events, '4/4'), true);
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  // three roughly-even onsets inside beat 0, then quarters at 1, 2, 3
  assert.equal(onsets.length, 6);
  assert.ok(Math.abs(onsets[0] - 0) < 1e-9);
  assert.ok(onsets[1] > 0.32 && onsets[1] < 0.34, `expected ~1/3s, got ${onsets[1]}`);
  assert.ok(onsets[2] > 0.65 && onsets[2] < 0.67, `expected ~2/3s, got ${onsets[2]}`);
  assert.deepEqual(onsets.slice(3), [1, 2, 3]);
});

test('a quarter-note triplet fits exactly in the space of two beats', () => {
  const cell = CELLS.qt3;
  assert.equal(cell.reduce((s, e) => s + e.dur, 0), TPQ * 2);
  cell.forEach(e => assert.equal(e.triplet, true));
});

// ---- dotted eighth + sixteenth --------------------------------------------
test('dotted eighth plus sixteenth sums to one beat and is not evenly split', () => {
  const cell = CELLS.des;
  assert.equal(cell[0].dur + cell[1].dur, TPQ);
  assert.equal(cell[0].dur, (TPQ * 3) / 4);
  assert.equal(cell[1].dur, TPQ / 4);
  const phrase = buildPhrase({ metre: '4/4', cells: ['des', 'q', 'q', 'q'] });
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  assert.deepEqual(onsets, [0, 0.75, 1, 2, 3]);
});

// ---- 3/4 --------------------------------------------------------------
test('3/4: three quarters and half+quarter both validate; three quarters is 1440 ticks', () => {
  const p1 = buildPhrase({ metre: '3/4', cells: ['qqq'] });
  const p2 = buildPhrase({ metre: '3/4', cells: ['hq'] });
  assert.equal(validateBar(p1.events, '3/4'), true);
  assert.equal(validateBar(p2.events, '3/4'), true);
  assert.equal(totalTicks(p1.events), 3 * TPQ);
  assert.equal(METRES['3/4'].ticksPerBar, 3 * TPQ);
});

test('3/4: a bar one beat short fails validateBar', () => {
  const phrase = buildPhrase({ metre: '3/4', cells: ['q', 'q'] });
  assert.equal(validateBar(phrase.events, '3/4'), false);
});

// ---- 6/8 --------------------------------------------------------------
test('6/8 groups as two dotted-quarter beats, not six independent eighths', () => {
  assert.equal(METRES['6/8'].beats, 2);
  assert.equal(METRES['6/8'].beatUnit, (TPQ * 3) / 2);
  const phrase = buildPhrase({ metre: '6/8', cells: ['dq', 'e3'] });
  assert.equal(validateBar(phrase.events, '6/8'), true);
  const onsets = onsetsOf(phrase.events, { bpm: 60 });
  // dq at beat0 (0s, lasts 1.5s); e3 = three eighths (0.5s each) starting at 1.5s
  assert.deepEqual(onsets, [0, 1.5, 2, 2.5]);
});

test('6/8 and 3/4 bars are the same length in ticks', () => {
  assert.equal(METRES['6/8'].ticksPerBar, METRES['3/4'].ticksPerBar);
});

// ---- swing ------------------------------------------------------------
test('swing 0 leaves eighths even', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['ee'] });
  const onsets = onsetsOf(phrase.events, { bpm: 60, swing: 0 });
  assert.deepEqual(onsets, [0, 0.5]);
});

test('swing 1 pushes the off-beat eighth to the full triplet position (2/3 of the beat)', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['ee'] });
  const onsets = onsetsOf(phrase.events, { bpm: 60, swing: 1 });
  assert.equal(onsets[0], 0);
  assert.ok(Math.abs(onsets[1] - 2 / 3) < 1e-9, `expected exactly 2/3s, got ${onsets[1]}`);
});

test('swing only shifts an off-beat eighth, never an on-beat note', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['q', 'q'] });
  const onsets = onsetsOf(phrase.events, { bpm: 60, swing: 1 });
  assert.deepEqual(onsets, [0, 1]);
});

// ---- validateBar generic ---------------------------------------------------
test('validateBar rejects a bar that is too long', () => {
  const phrase = buildPhrase({ metre: '4/4', cells: ['q', 'q', 'q', 'q', 'q'] });
  assert.equal(validateBar(phrase.events, '4/4'), false);
});

test('buildPhrase throws on an unknown cell or metre', () => {
  assert.throws(() => buildPhrase({ metre: '4/4', cells: ['nope'] }));
  assert.throws(() => buildPhrase({ metre: '5/8', cells: ['q'] }));
});
