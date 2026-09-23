import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHistoryStore, GOAL_MIN_DEFAULT, GOAL_MIN_MIN, GOAL_MIN_MAX } from '../../src/ui/history/store.js';

test('missing or invalid goalMin sanitizes to the default', () => {
  assert.equal(sanitizeHistoryStore(null).goalMin, GOAL_MIN_DEFAULT);
  assert.equal(sanitizeHistoryStore({}).goalMin, GOAL_MIN_DEFAULT);
  assert.equal(sanitizeHistoryStore({ goalMin: 'ten' }).goalMin, GOAL_MIN_DEFAULT);
  assert.equal(sanitizeHistoryStore({ goalMin: NaN }).goalMin, GOAL_MIN_DEFAULT);
  assert.equal(sanitizeHistoryStore({ goalMin: null }).goalMin, GOAL_MIN_DEFAULT);
});

test('a valid goalMin is rounded and kept', () => {
  assert.equal(sanitizeHistoryStore({ goalMin: 30 }).goalMin, 30);
  assert.equal(sanitizeHistoryStore({ goalMin: 22.6 }).goalMin, 23);
});

test('an out-of-range goalMin is clamped, never dropped', () => {
  assert.equal(sanitizeHistoryStore({ goalMin: 1 }).goalMin, GOAL_MIN_MIN);
  assert.equal(sanitizeHistoryStore({ goalMin: 9999 }).goalMin, GOAL_MIN_MAX);
});

test('learnerName sanitization is unaffected by the new field', () => {
  assert.deepEqual(sanitizeHistoryStore({ learnerName: 'Ada', goalMin: 20 }), { learnerName: 'Ada', goalMin: 20 });
});
