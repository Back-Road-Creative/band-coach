import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLibrary, memoryStore, indexedDbStore } from '../../src/song/library.js';
import { SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';

function song(id, overrides = {}) {
  return {
    schema: SCHEMA, id, title: overrides.title || 'Song ' + id, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }] }],
    chords: [],
    ...overrides
  };
}

// ---- createLibrary over memoryStore ----

test('add stores a normalized song retrievable by get; get(missing) is null', async () => {
  const library = createLibrary(memoryStore());
  const id = await library.add(song('a'), { now: 1000 });
  assert.equal(id, 'a');
  assert.equal((await library.get('a')).title, 'Song a');
  assert.equal(await library.get('nope'), null);

  await library.add({ id: 'raw', parts: [] }, { now: 1000 });
  const raw = await library.get('raw');
  assert.equal(raw.schema, SCHEMA);
  assert.equal(raw.title, 'Untitled');
});

test('add rejects an unfixable song and a missing now', async () => {
  const library = createLibrary(memoryStore());
  await assert.rejects(() => library.add({ title: 'no id' }, { now: 1000 }), /id/);
  await assert.rejects(() => library.add(song('a'), {}), /now/);
});

test('add assigns a fresh id on a clash instead of overwriting', async () => {
  const library = createLibrary(memoryStore());
  await library.add(song('dup', { title: 'first' }), { now: 1000 });
  const secondId = await library.add(song('dup', { title: 'second' }), { now: 2000 });
  assert.equal(secondId, 'dup-2');
  assert.equal((await library.get('dup')).title, 'first');
  assert.equal((await library.get('dup-2')).title, 'second');
});

test('add refuses a song over 5MB', async () => {
  const library = createLibrary(memoryStore());
  const notes = [];
  for (let i = 0; i < 400000; i++) notes.push({ start: i, dur: 1, midi: 60 });
  const huge = song('huge', { parts: [{ id: 'p', name: 'P', notes }] });
  await assert.rejects(() => library.add(huge, { now: 1000 }), /5 ?MB|too large/i);
});

test('list returns metadata only, no note data', async () => {
  const library = createLibrary(memoryStore());
  await library.add(song('a'), { now: 1000 });
  await library.add(song('b'), { now: 2000 });
  const list = await library.list();
  assert.equal(list.length, 2);
  const a = list.find(m => m.id === 'a');
  assert.equal(a.title, 'Song a');
  assert.equal(a.addedAt, 1000);
  assert.equal(a.durationTicks, 480);
  assert.equal('parts' in a, false);
});

test('rename updates title everywhere and validates its input', async () => {
  const library = createLibrary(memoryStore());
  await library.add(song('a'), { now: 1000 });
  await library.rename('a', 'New Title');
  assert.equal((await library.get('a')).title, 'New Title');
  assert.equal((await library.list())[0].title, 'New Title');
  await assert.rejects(() => library.rename('missing', 'x'), /no song/);
  await assert.rejects(() => library.rename('a', ''), /non-empty/);
});

test('remove deletes the song and its metadata; missing id is a no-op', async () => {
  const library = createLibrary(memoryStore());
  await library.add(song('a'), { now: 1000 });
  await library.remove('a');
  assert.equal(await library.get('a'), null);
  assert.deepEqual(await library.list(), []);
  await assert.doesNotReject(() => library.remove('missing'));
});

test('exportAll/importAll round-trip full song bodies without clobbering ids', async () => {
  const source = createLibrary(memoryStore());
  await source.add(song('a'), { now: 1000 });
  await source.add(song('b'), { now: 2000 });
  const backup = await source.exportAll();
  assert.equal(backup.find(s => s.id === 'a').parts[0].notes[0].midi, 60);

  const dest = createLibrary(memoryStore());
  const result = await dest.importAll(backup);
  assert.equal(result.imported, 2);
  assert.equal((await dest.list()).length, 2);

  const resultFromJson = await createLibrary(memoryStore()).importAll(JSON.stringify(backup));
  assert.equal(resultFromJson.imported, 2);

  await dest.add(song('c', { title: 'existing' }), { now: 3000 });
  const clash = await dest.importAll([song('c', { title: 'incoming' })]);
  assert.equal((await dest.get('c')).title, 'existing');
  assert.equal((await dest.get(clash.ids[0])).title, 'incoming');

  await assert.rejects(() => dest.importAll({ not: 'an array' }), /array/);
});

// ---- indexedDbStore against a minimal fake indexedDB ----
//
// Just enough of open/onupgradeneeded, transaction, objectStore,
// get/put/delete/getAllKeys to exercise indexedDbStore.

function makeFakeIndexedDB() {
  const databases = new Map();

  class FakeRequest { onsuccess = null; onerror = null; result; error; }

  function schedule(req, work, onSettled) {
    queueMicrotask(() => {
      try {
        req.result = work();
        if (req.onsuccess) req.onsuccess({ target: req });
        if (onSettled) queueMicrotask(() => onSettled(true));
      } catch (e) {
        req.error = e;
        if (req.onerror) req.onerror({ target: req });
        if (onSettled) queueMicrotask(() => onSettled(false));
      }
    });
  }

  class FakeObjectStore {
    constructor(map, tx) { this._map = map; this._tx = tx; }
    get(key) { const r = new FakeRequest(); schedule(r, () => this._map.get(key), ok => this._tx._settle(ok)); return r; }
    put(value, key) { const r = new FakeRequest(); schedule(r, () => { this._map.set(key, value); return key; }, ok => this._tx._settle(ok)); return r; }
    delete(key) { const r = new FakeRequest(); schedule(r, () => { this._map.delete(key); return undefined; }, ok => this._tx._settle(ok)); return r; }
    getAllKeys() { const r = new FakeRequest(); schedule(r, () => Array.from(this._map.keys()), ok => this._tx._settle(ok)); return r; }
  }

  class FakeTransaction {
    constructor(store) { this._store = store; this.oncomplete = null; this.onerror = null; this.onabort = null; }
    objectStore() { return new FakeObjectStore(this._store, this); }
    _settle(ok) {
      if (ok) { if (this.oncomplete) this.oncomplete({ target: this }); }
      else if (this.onerror) this.onerror({ target: this });
    }
  }

  class FakeDatabase {
    constructor() { this._stores = new Map(); this.objectStoreNames = { contains: name => this._stores.has(name) }; }
    createObjectStore(name) { const map = new Map(); this._stores.set(name, map); return new FakeObjectStore(map, { _settle() {} }); }
    transaction(name) { return new FakeTransaction(this._stores.get(name)); }
  }

  return {
    open(name) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        let db = databases.get(name);
        let isNew = false;
        if (!db) { db = new FakeDatabase(); databases.set(name, db); isNew = true; }
        req.result = db;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };
}

test('indexedDbStore put/get/delete/keys round-trip via the fake indexedDB', async () => {
  const store = indexedDbStore(makeFakeIndexedDB(), 'test-db');
  await store.put('song:a', { id: 'a' });
  await store.put('song:b', { id: 'b' });
  assert.deepEqual(await store.get('song:a'), { id: 'a' });
  assert.deepEqual((await store.keys()).sort(), ['song:a', 'song:b']);
  await store.delete('song:a');
  assert.equal(await store.get('song:a'), undefined);
  assert.deepEqual(await store.keys(), ['song:b']);
});

test('createLibrary works end to end over indexedDbStore', async () => {
  const library = createLibrary(indexedDbStore(makeFakeIndexedDB(), 'band-coach-songs'));
  await library.add(song('a'), { now: 42 });
  assert.equal((await library.get('a')).id, 'a');
  const list = await library.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].addedAt, 42);
  await library.remove('a');
  assert.equal(await library.get('a'), null);
});
