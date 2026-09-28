import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handsTogetherById,
  handsModeFromId,
  bothUnlocked,
  isTimedPairId,
  gradeTimedPair,
  PAIR_ONSET_TOL_MS,
  PAIR_RELEASE_TOL_MS,
  HANDS_TOGETHER_EXERCISES
} from '../../src/core/hands-together.js';

test('isTimedPairId recognises only the t-suffixed pair ids', () => {
  assert.equal(isTimedPairId('j1t'), true);
  assert.equal(isTimedPairId('j5t'), true);
  assert.equal(isTimedPairId('j1'), false);
  assert.equal(isTimedPairId('j1r'), false);
  assert.equal(isTimedPairId('j1l'), false);
  assert.equal(isTimedPairId('j1x'), false);
  assert.equal(isTimedPairId('c'), false);
});

test('handsTogetherById finds the same exercise for a timed id, and handsModeFromId reports both', () => {
  const base = handsTogetherById('j3');
  assert.equal(handsTogetherById('j3t').name, base.name);
  assert.equal(handsModeFromId('j3t'), 'both');
});

test('bothUnlocked ignores timed-pair item records: j1t alone must not unlock Both', () => {
  assert.equal(bothUnlocked({ item: { j1t: { seen: 3, reps: 2 } } }), false);
});

const ex = HANDS_TOGETHER_EXERCISES[0]; // C: rh 60, lh 48

test('gradeTimedPair: waiting until both hands have an onset', () => {
  assert.equal(gradeTimedPair(ex, { on: {}, off: {} }).state, 'waiting');
  assert.equal(gradeTimedPair(ex, { on: { 60: 1000 }, off: {} }).state, 'waiting');
});

test('gradeTimedPair: onsets within tolerance and no release yet is waiting', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1000, 48: 1020 }, off: {} });
  assert.equal(r.state, 'waiting');
});

test('gradeTimedPair: onsets more than PAIR_ONSET_TOL_MS apart fails with a directional reason', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1200, 48: 1000 }, off: {} });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /right hand came in 200 ms after the left hand/i);
  assert.equal(r.deltaMs, 200);
});

test('gradeTimedPair: left hand late is the mirrored reason', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1000, 48: 1200 }, off: {} });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /left hand came in 200 ms after the right hand/i);
});

test('gradeTimedPair: onsets together but releases more than PAIR_RELEASE_TOL_MS apart fails', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1000, 48: 1000 }, off: { 60: 2000, 48: 2300 } });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /let go/i);
});

test('gradeTimedPair: onsets together, one release missing, is waiting', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1000, 48: 1000 }, off: { 60: 2000 } });
  assert.equal(r.state, 'waiting');
});

test('gradeTimedPair: both onsets and releases within tolerance pass', () => {
  const r = gradeTimedPair(ex, { on: { 60: 1000, 48: 1000 }, off: { 60: 2000, 48: 2000 } });
  assert.equal(r.state, 'pass');
});

test('PAIR_ONSET_TOL_MS and PAIR_RELEASE_TOL_MS have the specified values', () => {
  assert.equal(PAIR_ONSET_TOL_MS, 100);
  assert.equal(PAIR_RELEASE_TOL_MS, 150);
});
