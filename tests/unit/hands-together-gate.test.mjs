import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDS_TOGETHER_EXERCISES, bothUnlocked, effectiveHands, prepLine } from '../../src/core/hands-together.js';

test('bothUnlocked: no model or empty model is locked', () => {
  assert.equal(bothUnlocked(null), false);
  assert.equal(bothUnlocked({ item: {} }), false);
});

test('bothUnlocked: only the right hand alone shown is still locked', () => {
  assert.equal(bothUnlocked({ item: { j1r: { seen: 3 } } }), false);
});

test('bothUnlocked: both the right hand alone and the left hand alone shown unlocks', () => {
  assert.equal(bothUnlocked({ item: { j1r: { seen: 3 }, j1l: { seen: 5 } } }), true);
});

test('bothUnlocked: an it() placeholder (seen 0, reps 0) does not count as shown', () => {
  assert.equal(bothUnlocked({ item: { j1r: { seen: 0, reps: 0 }, j1l: { seen: 5 } } }), false);
});

test('bothUnlocked: a genuinely used plain j-id grandfathers Both open', () => {
  assert.equal(bothUnlocked({ item: { j3: { seen: 4, reps: 2 } } }), true);
});

test('bothUnlocked: an evaluate() placeholder plain j-id (seen 0, reps 0) does not grandfather', () => {
  assert.equal(bothUnlocked({ item: { j3: { seen: 0, reps: 0 } } }), false);
});

test('bothUnlocked: a plain j-id with reps 1 but seen 0 still grandfathers', () => {
  assert.equal(bothUnlocked({ item: { j3: { seen: 0, reps: 1 } } }), true);
});

test('effectiveHands: both stays right while locked, both once unlocked', () => {
  assert.equal(effectiveHands('both', false), 'right');
  assert.equal(effectiveHands('both', true), 'both');
});

test('effectiveHands: right/left pass through regardless of lock state', () => {
  assert.equal(effectiveHands('left', false), 'left');
});

test('effectiveHands: an unrecognised pref normalises to both, so it too is gated', () => {
  assert.equal(effectiveHands('bogus', false), 'right');
});

test('prepLine: names each hand\'s starting finger and key for the default C position', () => {
  const line = prepLine(HANDS_TOGETHER_EXERCISES[0]);
  assert.equal(line, 'Before you start: right hand thumb (finger 1) on C4; left hand little finger (finger 5) on C3.');
});

test('prepLine: uses an injected note namer', () => {
  const ex = HANDS_TOGETHER_EXERCISES[0];
  const line = prepLine(ex, m => 'M' + m);
  assert.equal(line, 'Before you start: right hand thumb (finger 1) on M' + ex.rh.midi + '; left hand little finger (finger 5) on M' + ex.lh.midi + '.');
});
