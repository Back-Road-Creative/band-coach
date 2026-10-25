// E6: caught runtime errors were silently swallowed (app.js catch blocks did
// `errCount++` and nothing else) with no way to see what actually went wrong.
// This module keeps a small ring of the most recent ones so the app can
// surface the last message and a debug hook can inspect the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordError, getErrors, clearErrors, persistErrors } from '../../src/core/error-log.js';

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

// P4: the error notice says "Reload, then Settings > Copy diagnostics", so the
// ring must survive a reload of the same tab. persistErrors() is handed a
// Storage-like object (sessionStorage in the app) and a key.

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

test('persistErrors writes each recorded error and a later page reads them back', () => {
  clearErrors();
  const store = fakeStorage();
  persistErrors(store, 'k');
  recordError('frame', new Error('before reload'));
  assert.equal(JSON.parse(store.getItem('k'))[0].message, 'before reload');
  clearErrors(); // a fresh page starts with an empty ring
  persistErrors(store, 'k');
  assert.deepEqual(getErrors().map((e) => e.message), ['before reload']);
});

test('persistErrors keeps errors recorded before it was attached, after the stored ones', () => {
  clearErrors();
  const store = fakeStorage({ k: JSON.stringify([{ message: 'old', where: 'a', time: 1 }]) });
  recordError('boot', new Error('early'));
  persistErrors(store, 'k');
  assert.deepEqual(getErrors().map((e) => e.message), ['old', 'early']);
  assert.equal(JSON.parse(store.getItem('k')).length, 2, 'the merged ring is written straight away');
});

test('persistErrors ignores junk in storage and keeps only well-formed entries, capped at 20', () => {
  clearErrors();
  persistErrors(fakeStorage({ k: '{not json' }), 'k');
  assert.deepEqual(getErrors(), []);
  const many = Array.from({ length: 30 }, (_, i) => ({ message: 'm' + i, where: 'w', time: i }));
  persistErrors(fakeStorage({ k: JSON.stringify([...many, { message: 5 }, null, 'x']) }), 'k');
  const got = getErrors();
  assert.equal(got.length, 20);
  assert.equal(got[19].message, 'm29');
});

test('a storage that throws never breaks recordError', () => {
  clearErrors();
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  persistErrors(bad, 'k');
  assert.equal(recordError('frame', new Error('still kept')).message, 'still kept');
  assert.equal(getErrors().length, 1);
});
