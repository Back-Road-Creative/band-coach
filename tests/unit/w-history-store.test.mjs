import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHistoryStore, MAX_LEARNER_NAME, GOAL_MIN_DEFAULT } from '../../src/ui/history/store.js';

test('garbage or missing input sanitizes to an empty name', () => {
  assert.deepEqual(sanitizeHistoryStore(null), { learnerName: '', goalMin: GOAL_MIN_DEFAULT });
  assert.deepEqual(sanitizeHistoryStore({}), { learnerName: '', goalMin: GOAL_MIN_DEFAULT });
  assert.deepEqual(sanitizeHistoryStore({ learnerName: 42 }), { learnerName: '', goalMin: GOAL_MIN_DEFAULT });
  assert.deepEqual(sanitizeHistoryStore('garbage'), { learnerName: '', goalMin: GOAL_MIN_DEFAULT });
});

test('a real name is trimmed and kept', () => {
  assert.deepEqual(sanitizeHistoryStore({ learnerName: '  Ada  ' }), { learnerName: 'Ada', goalMin: GOAL_MIN_DEFAULT });
});

test('an oversized name is capped, never dropped entirely', () => {
  const long = 'x'.repeat(500);
  const out = sanitizeHistoryStore({ learnerName: long });
  assert.equal(out.learnerName.length, MAX_LEARNER_NAME);
  assert.equal(out.learnerName, 'x'.repeat(MAX_LEARNER_NAME));
});
