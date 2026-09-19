// E6: caught runtime errors were silently swallowed (app.js catch blocks did
// `errCount++` and nothing else) with no way to see what actually went wrong.
// This module keeps a small ring of the most recent ones so the app can
// surface the last message and a debug hook can inspect the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordError, getErrors, clearErrors } from '../../src/core/error-log.js';

test('recordError keeps message, where and a time for each entry', () => {
  clearErrors();
  const before = Date.now();
  const entry = recordError('frame', new Error('boom'));
  assert.equal(entry.message, 'boom');
  assert.equal(entry.where, 'frame');
  assert.ok(entry.time >= before, 'time is recorded at call time');
});

test('recordError accepts a plain string in place of an Error', () => {
  clearErrors();
  const entry = recordError('onPitch', 'something odd');
  assert.equal(entry.message, 'something odd');
});

test('getErrors returns the ring in oldest-to-newest order, capped at 20', () => {
  clearErrors();
  for (let i = 0; i < 25; i++) recordError('onPitch', new Error('e' + i));
  const errors = getErrors();
  assert.equal(errors.length, 20, 'only the last 20 are kept');
  assert.equal(errors[0].message, 'e5', 'the oldest 5 were dropped');
  assert.equal(errors[errors.length - 1].message, 'e24', 'the newest entry is last');
});

test('getErrors returns a copy, not the live ring', () => {
  clearErrors();
  recordError('frame', new Error('one'));
  const errors = getErrors();
  errors.push({ message: 'tampered', where: 'x', time: 0 });
  assert.equal(getErrors().length, 1, 'mutating the returned array must not affect the ring');
});

test('clearErrors empties the ring', () => {
  recordError('frame', new Error('one'));
  clearErrors();
  assert.deepEqual(getErrors(), []);
});
