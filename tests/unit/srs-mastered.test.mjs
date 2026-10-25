import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mastered } from '../../src/core/srs.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const strong = (extra = {}) => ({ stability: 100, difficulty: 0.3, lastSeen: NOW - DAY, reps: 5, lapses: 0, ...extra });

test('picks the strongest well-known item from the ids given', () => {
  const items = { a: strong({ lastSeen: NOW - 5 * DAY }), b: strong(), c: strong({ lastSeen: NOW - 3 * DAY }) };
  assert.equal(mastered(items, ['a', 'b', 'c'], NOW), 'b');
});

test('an item seen fewer than three times is not mastered, however fresh', () => {
  assert.equal(mastered({ a: strong({ reps: 2 }) }, ['a'], NOW), null);
});

test('an item that has faded below 90% is not mastered', () => {
  assert.equal(mastered({ a: strong({ stability: 5, lastSeen: NOW - 5 * DAY }) }, ['a'], NOW), null);
});

test('only the ids asked about count, and unknown ids are skipped', () => {
  const items = { a: strong(), b: strong() };
  assert.equal(mastered(items, ['b', 'zz'], NOW), 'b');
  assert.equal(mastered(items, [], NOW), null);
  assert.equal(mastered(null, ['a'], NOW), null);
});

test('ties break by id so the pick is deterministic', () => {
  const items = { b: strong(), a: strong() };
  assert.equal(mastered(items, ['b', 'a'], NOW), 'a');
});
