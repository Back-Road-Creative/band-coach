import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOutcome } from '../../src/core/grade-outcome.js';

test('gradeOutcome: helped skips review and level, and forces q to 0', () => {
  assert.deepEqual(gradeOutcome({ helped: true, q: 1 }), { review: false, level: false, q: 0 });
  assert.deepEqual(gradeOutcome({ helped: true, q: 0 }), { review: false, level: false, q: 0 });
});

test('gradeOutcome: approximate assistance reviews but does not raise level', () => {
  assert.deepEqual(gradeOutcome({ assistance: 'approximate', q: 0.7 }), { review: true, level: false, q: 0.7 });
});

test('gradeOutcome: a normal answer (no help, no assistance) reviews and raises level', () => {
  assert.deepEqual(gradeOutcome({ q: 1 }), { review: true, level: true, q: 1 });
  assert.deepEqual(gradeOutcome({ q: 0 }), { review: true, level: true, q: 0 });
});

test('gradeOutcome: helped takes priority over approximate assistance', () => {
  assert.deepEqual(gradeOutcome({ helped: true, assistance: 'approximate', q: 0.7 }), { review: false, level: false, q: 0 });
});

test('gradeOutcome: no args defaults to a normal, unhelped, ungraded answer', () => {
  assert.deepEqual(gradeOutcome(), { review: true, level: true, q: 0 });
});
