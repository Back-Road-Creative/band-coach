// eraseAll (src/core/erase-all.js): removes everything the app keeps on this
// device and nothing else, and never throws when a store is missing or broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseAll, APP_DATABASES } from '../../src/core/erase-all.js';

function fakeStorage(seed, { enumerable = true } = {}) {
  const data = { ...seed };
  const s = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; }, _data: data };
  if (enumerable) { Object.defineProperty(s, 'length', { get: () => Object.keys(data).length }); s.key = (i) => Object.keys(data)[i] ?? null; }
  return s;
}
const SEED = { 'bandcoach.v1': '{}', 'bandcoach.v1.corrupt': '{"mods":', 'bandcoach.v1.backupAt': '5', 'bandcoach.v1.tuneAsked': '[]', 'bandcoach.v2.future': 'x', other: 'keep' };

test('removes every app key including the corrupt copy, keeps unrelated keys', async () => {
  const storage = fakeStorage(SEED);
  const r = await eraseAll({ storage });
  assert.deepEqual(Object.keys(storage._data), ['other']);
  assert.equal(r.ok, true);
});

test('still removes the known keys when the store cannot be enumerated', async () => {
  const storage = fakeStorage(SEED, { enumerable: false });
  await eraseAll({ storage });
  assert.equal(storage.getItem('bandcoach.v1'), null);
  assert.equal(storage.getItem('bandcoach.v1.corrupt'), null);
  assert.equal(storage.getItem('other'), 'keep');
});

test('deletes each app database and reports a blocked one as not ok', async () => {
  const asked = [];
  const indexedDB = { deleteDatabase: (name) => { const req = {}; asked.push(name); setTimeout(() => req.onsuccess(), 0); return req; } };
  const r = await eraseAll({ indexedDB });
  assert.deepEqual(asked.sort(), [...APP_DATABASES].sort());
  assert.ok(APP_DATABASES.includes('bandcoach-songs') && APP_DATABASES.includes('band-coach-model-packs'));
  assert.equal(r.ok, true);
  const bad = { deleteDatabase: () => { const req = {}; setTimeout(() => req.onerror(), 0); return req; } };
  assert.equal((await eraseAll({ indexedDB: bad })).ok, false);
});

test('a blocked delete is not done: it counts once it succeeds, and one that stays blocked (another tab) is not ok', async () => {
  const unblocks = { deleteDatabase: () => { const req = {}; setTimeout(() => req.onblocked && req.onblocked(), 0); setTimeout(() => req.onsuccess(), 5); return req; } };
  assert.equal((await eraseAll({ indexedDB: unblocks }, { timeoutMs: 200 })).ok, true);
  const stays = { deleteDatabase: () => { const req = {}; setTimeout(() => req.onblocked && req.onblocked(), 0); return req; } };
  assert.equal((await eraseAll({ indexedDB: stays }, { timeoutMs: 20 })).ok, false);
});

test('a database delete that never answers does not hang the erase', async () => {
  const r = await eraseAll({ indexedDB: { deleteDatabase: () => ({}) } }, { timeoutMs: 20 });
  assert.equal(r.ok, false);
});

test('clears only this app\'s caches', async () => {
  const deleted = [];
  const caches = { keys: async () => ['band-coach-pages-v1.2.3', 'someone-else'], delete: async (k) => { deleted.push(k); return true; } };
  await eraseAll({ caches });
  assert.deepEqual(deleted, ['band-coach-pages-v1.2.3']);
});

test('works with every store undefined, null or throwing', async () => {
  assert.equal((await eraseAll({})).ok, true);
  assert.equal((await eraseAll()).ok, true);
  const boom = () => { throw new Error('no'); };
  const r = await eraseAll({ storage: { getItem: boom, setItem: boom, removeItem: boom, length: 1, key: boom }, indexedDB: { deleteDatabase: boom }, caches: { keys: boom, delete: boom } });
  assert.equal(r.ok, false);
});
