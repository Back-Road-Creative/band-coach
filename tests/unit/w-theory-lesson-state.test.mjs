import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initLessonState, sanitizeLessonState, recordAnswer } from '../../src/ui/theory/lesson-state.js';

test('initLessonState starts at level 1, seed 0, streak 0', () => {
  assert.deepEqual(initLessonState(), { level: 1, seed: 0, streak: 0 });
});

test('sanitizeLessonState falls back to defaults for missing/bad fields', () => {
  assert.deepEqual(sanitizeLessonState(null, 5), { level: 1, seed: 0, streak: 0 });
  assert.deepEqual(sanitizeLessonState({ level: 3, seed: 7, streak: 2 }, 5), { level: 3, seed: 7, streak: 2 });
  assert.deepEqual(sanitizeLessonState({ level: 99, seed: -1, streak: 'x' }, 5), { level: 1, seed: 0, streak: 0 });
});

test('recordAnswer resets the streak on a wrong answer but never lowers the level', () => {
  const state = { level: 2, seed: 4, streak: 2 };
  const { next, leveledUp } = recordAnswer(state, false, 5);
  assert.deepEqual(next, { level: 2, seed: 5, streak: 0 });
  assert.equal(leveledUp, false);
});

test('recordAnswer grows the streak on a correct answer', () => {
  const state = { level: 2, seed: 4, streak: 0 };
  const { next, leveledUp } = recordAnswer(state, true, 5);
  assert.deepEqual(next, { level: 2, seed: 5, streak: 1 });
  assert.equal(leveledUp, false);
});

test('recordAnswer levels up after a run of 3 correct answers and resets the streak', () => {
  let state = { level: 1, seed: 0, streak: 0 };
  let leveledUp;
  ({ next: state, leveledUp } = recordAnswer(state, true, 5));
  assert.equal(leveledUp, false);
  ({ next: state, leveledUp } = recordAnswer(state, true, 5));
  assert.equal(leveledUp, false);
  ({ next: state, leveledUp } = recordAnswer(state, true, 5));
  assert.equal(leveledUp, true);
  assert.deepEqual(state, { level: 2, seed: 3, streak: 0 });
});

test('recordAnswer never advances past the last level', () => {
  let state = { level: 5, seed: 0, streak: 2 };
  const { next, leveledUp } = recordAnswer(state, true, 5);
  assert.equal(leveledUp, false);
  assert.deepEqual(next, { level: 5, seed: 1, streak: 3 });
});

test('seed always advances, correct or not', () => {
  const correct = recordAnswer({ level: 1, seed: 10, streak: 0 }, true, 5);
  const wrong = recordAnswer({ level: 1, seed: 10, streak: 0 }, false, 5);
  assert.equal(correct.next.seed, 11);
  assert.equal(wrong.next.seed, 11);
});
