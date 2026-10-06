// safeSet/safeGet (src/core/storage.js): the old app.js write was a bare
// `try { localStorage.setItem(...) } catch (e) {}` -- a QuotaExceededError,
// a SecurityError (private-mode/disabled storage in some browsers), or a
// store that silently accepts the call but stores something else entirely
// all looked identical to "saved fine". These fakes exercise each failure
// mode without a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeSet, safeGet } from '../../src/core/storage.js';

function fakeStorage(overrides = {}) {
  const data = {};
  return Object.assign({
    setItem(key, value) { data[key] = String(value); },
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    removeItem(key) { delete data[key]; },
    _data: data,
  }, overrides);
}

test('safeSet reports ok:true when the write reads back exactly what was stored', () => {
  const storage = fakeStorage();
  const result = safeSet(storage, 'k', 'hello');
  assert.deepEqual(result, { ok: true });
  assert.equal(storage.getItem('k'), 'hello');
});

test('safeSet reports the thrown error name when setItem throws QuotaExceededError', () => {
  const storage = fakeStorage({
    setItem() { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
  });
  const result = safeSet(storage, 'k', 'hello');
  assert.deepEqual(result, { ok: false, reason: 'QuotaExceededError' });
});

test('safeSet reports the thrown error name when setItem throws SecurityError (private mode)', () => {
  const storage = fakeStorage({
    setItem() { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; },
  });
  const result = safeSet(storage, 'k', 'hello');
  assert.deepEqual(result, { ok: false, reason: 'SecurityError' });
});

test('safeSet reports "unknown" for a thrown error with no name', () => {
  const storage = fakeStorage({ setItem() { throw new Error('mystery'); } });
  const result = safeSet(storage, 'k', 'hello');
  // A plain Error still has name 'Error', so force a truly nameless one.
  const nameless = fakeStorage({ setItem() { throw { message: 'nameless' }; } });
  const result2 = safeSet(nameless, 'k', 'hello');
  assert.equal(result.ok, false);
  assert.deepEqual(result2, { ok: false, reason: 'unknown' });
});

test('safeSet reports ok:false with reason "mismatch" when the store accepts the write but reads back something else', () => {
  const storage = fakeStorage({ setItem() { /* silently drops the write */ }, getItem() { return 'something-else'; } });
  const result = safeSet(storage, 'k', 'hello');
  assert.deepEqual(result, { ok: false, reason: 'mismatch' });
});

test('safeSet reports ok:false when the read-back itself throws', () => {
  const storage = fakeStorage({ getItem() { const e = new Error('locked'); e.name = 'SecurityError'; throw e; } });
  const result = safeSet(storage, 'k', 'hello');
  assert.deepEqual(result, { ok: false, reason: 'SecurityError' });
});

test('safeGet returns ok:true, value:null, corrupt:false for a never-saved key', () => {
  const storage = fakeStorage();
  assert.deepEqual(safeGet(storage, 'missing'), { ok: true, value: null, corrupt: false });
});

test('safeGet parses valid JSON and reports corrupt:false', () => {
  const storage = fakeStorage();
  storage.setItem('k', JSON.stringify({ a: 1 }));
  assert.deepEqual(safeGet(storage, 'k'), { ok: true, value: { a: 1 }, corrupt: false });
});

test('safeGet reports ok:false for a store whose read itself throws', () => {
  const storage = fakeStorage({ getItem() { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; } });
  assert.deepEqual(safeGet(storage, 'k'), { ok: false, value: null, corrupt: false });
});

test('safeGet reports corrupt:true for unparseable JSON, without throwing', () => {
  const storage = fakeStorage();
  storage.setItem('k', '{not json');
  const result = safeGet(storage, 'k');
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
  assert.equal(result.corrupt, true);
});

test('safeGet preserves the raw unparseable text under a "<key>.corrupt" side key rather than discarding it', () => {
  const storage = fakeStorage();
  storage.setItem('k', '{not json at all');
  safeGet(storage, 'k');
  assert.equal(storage.getItem('k.corrupt'), '{not json at all');
});

// getStorage(win): merely READING window.localStorage throws SecurityError in
// Chrome with all site data blocked (and some locked-down Safari setups), so
// the global cannot be passed as an argument -- the read itself has to sit
// inside a try. The fake window below throws from the getter exactly as the
// browser does.
import * as storageModule from '../../src/core/storage.js';

// Looked up off the namespace (not a named import) so a missing export fails
// the named assertion below instead of killing the whole file at link time.
function getStorage(win) {
  assert.equal(typeof storageModule.getStorage, 'function', 'src/core/storage.js must export getStorage');
  return storageModule.getStorage(win);
}

function blockedWindow(value) {
  const win = {};
  Object.defineProperty(win, 'localStorage', { get() { if (value === undefined) { const e = new Error('denied'); e.name = 'SecurityError'; throw e; } return value; } });
  return win;
}

test('getStorage hands back the real storage, not blocked, when the getter works', () => {
  const real = fakeStorage();
  const got = getStorage({ localStorage: real });
  assert.equal(got.storage, real);
  assert.equal(got.blocked, false);
});

test('getStorage survives a throwing localStorage getter with a working in-memory stand-in', () => {
  const got = getStorage(blockedWindow());
  assert.equal(got.blocked, true);
  assert.deepEqual(safeSet(got.storage, 'k', 'v'), { ok: true });
  assert.deepEqual(safeGet(got.storage, 'missing'), { ok: true, value: null, corrupt: false });
  got.storage.setItem('j', '{"a":1}');
  assert.deepEqual(safeGet(got.storage, 'j'), { ok: true, value: { a: 1 }, corrupt: false });
  got.storage.removeItem('j');
  assert.equal(got.storage.getItem('j'), null);
});

test('getStorage treats a null localStorage (some browsers) the same as a throwing getter', () => {
  const got = getStorage(blockedWindow(null));
  assert.equal(got.blocked, true);
  assert.equal(got.storage.getItem('anything'), null);
});
