// The pure rule behind "a failed drum bar comes round again": the same bar
// replays up to 3 tries in total, only a bar with hits repeats, and only the
// first failure of a bar is charged to readiness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitRepeatStep, kitRepeatFor, KIT_MAX_TRIES } from '../../src/instruments/drum-kit.js';

const BAR = { cells: 'a' }, OTHER = { cells: 'b' };
const ctx = (o) => Object.assign({ mod: 'drum-kit', level: 1, inTable: true, bar: BAR, failed: true, hits: 4 }, o);

test('a failed bar is owed a repeat, and the first failure is charged', () => {
  const s = kitRepeatStep(null, ctx());
  assert.equal(s.again, true);
  assert.equal(s.penalise, true);
  assert.equal(s.tryNo, 1);
  assert.equal(kitRepeatFor(s.rep, 'drum-kit', 1), s.rep);
});

test('three failures in a row: the third gives up, and only the first was charged', () => {
  const a = kitRepeatStep(null, ctx());
  const b = kitRepeatStep(a.rep, ctx());
  assert.deepEqual([b.again, b.penalise, b.tryNo], [true, false, 2]);
  const c = kitRepeatStep(b.rep, ctx());
  assert.deepEqual([c.again, c.giveUp, c.penalise, c.rep], [false, true, false, null]);
  assert.equal(KIT_MAX_TRIES, 3);
});

test('a clean repeat clears the count and is credited normally', () => {
  const a = kitRepeatStep(null, ctx());
  const b = kitRepeatStep(a.rep, ctx({ failed: false }));
  assert.deepEqual([b.rep, b.again, b.penalise], [null, false, true]);
  const c = kitRepeatStep(b.rep, ctx());
  assert.equal(c.tryNo, 1, 'a later failure starts a fresh count');
});

test('a bar with no hits never repeats (the learner may have walked away)', () => {
  const s = kitRepeatStep(null, ctx({ hits: 0 }));
  assert.deepEqual([s.rep, s.again, s.penalise], [null, false, true]);
  const mid = kitRepeatStep(kitRepeatStep(null, ctx()).rep, ctx({ hits: 0 }));
  assert.deepEqual([mid.rep, mid.again], [null, false]);
});

test('above the normal table (tighter window) nothing repeats', () => {
  const s = kitRepeatStep(null, ctx({ inTable: false }));
  assert.deepEqual([s.rep, s.again, s.penalise], [null, false, true]);
});

test('a different bar after a failure starts at try 1 and is charged', () => {
  const a = kitRepeatStep(null, ctx());
  const b = kitRepeatStep(a.rep, ctx({ bar: OTHER }));
  assert.deepEqual([b.tryNo, b.penalise], [1, true]);
});

test('a level or instrument change drops the owed repeat', () => {
  const a = kitRepeatStep(null, ctx());
  assert.equal(kitRepeatFor(a.rep, 'drum-kit', 2), null);
  assert.equal(kitRepeatFor(a.rep, 'piano', 1), null);
  assert.equal(kitRepeatFor(null, 'drum-kit', 1), null);
  const stale = kitRepeatStep(a.rep, ctx({ level: 2 }));
  assert.deepEqual([stale.tryNo, stale.penalise], [1, true]);
});
