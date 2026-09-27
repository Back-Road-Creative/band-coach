// describeWhy(blocks, nameOf) -> a second, separate sentence naming the weak
// skill's own reason (planSession's own record, never recomputed) -- see
// src/core/curriculum.js's describePlan for the sibling first sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, describeWhy } from '../../src/core/curriculum.js';
import { due } from '../../src/core/srs.js';

const DAY = 86400000;

function item({ stability = 10, lastSeen = 0, reps = 0, lapses = 0 } = {}) {
  return { stability, difficulty: 0.3, lastSeen, reps, lapses };
}

test('describeWhy: a lapsed weak skill reads "slipped before, worth another pass"', () => {
  const blocks = [{ kind: 'weak', id: 'n67', why: 'slipped before, worth another pass' }];
  const text = describeWhy(blocks, id => (id === 'n67' ? 'G4' : id));
  assert.equal(text, 'G4: slipped before, worth another pass.');
});

test('describeWhy: a never-lapsed weak skill reads "the one practiced least so far"', () => {
  const blocks = [{ kind: 'weak', id: 'n67', why: 'the one practiced least so far' }];
  const text = describeWhy(blocks, id => (id === 'n67' ? 'G4' : id));
  assert.equal(text, 'G4: the one practiced least so far.');
});

test('describeWhy: never names the raw internal id', () => {
  const blocks = [{ kind: 'weak', id: 'n67', why: 'slipped before, worth another pass' }];
  const text = describeWhy(blocks, id => (id === 'n67' ? 'G4' : id));
  assert.doesNotMatch(text, /\bn67\b/);
});

test('describeWhy: no weak block (review-only plan) -> empty string', () => {
  const blocks = [{ kind: 'review', ids: ['a'] }];
  assert.equal(describeWhy(blocks), '');
});

test('describeWhy: no blocks at all -> empty string', () => {
  assert.equal(describeWhy([]), '');
});

test('describeWhy: a weak block without a why -> empty string', () => {
  const blocks = [{ kind: 'weak', id: 'n67' }];
  assert.equal(describeWhy(blocks), '');
});

test('describeWhy: no nameOf given falls back to the raw id, unchanged', () => {
  const blocks = [{ kind: 'weak', id: 'n67', why: 'slipped before, worth another pass' }];
  assert.equal(describeWhy(blocks), 'n67: slipped before, worth another pass.');
});

test('describeWhy: end-to-end from a real planSession, lapsed item gives the "slipped before" sentence', () => {
  const now = 100 * DAY;
  const items = { n60: item({ stability: 5, lastSeen: 0, reps: 4, lapses: 1 }) };
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60'], items, now, due });
  const text = describeWhy(blocks, id => (id === 'n60' ? 'C' : id));
  assert.equal(text, 'C: slipped before, worth another pass.');
});
