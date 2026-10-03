import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLibrary, memoryStore, indexedDbStore } from '../../src/song/library.js';
import { SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';
import * as starter from '../../src/song/starter/index.js';

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
    get(key) { const r = new FakeRequest(); this._tx._begin(); schedule(r, () => this._map.get(key), ok => this._tx._settle(ok)); return r; }
    put(value, key) { const r = new FakeRequest(); this._tx._begin(); schedule(r, () => { this._map.set(key, value); return key; }, ok => this._tx._settle(ok)); return r; }
    // Like put, but throws (a ConstraintError, matching real IndexedDB) if
    // the key already exists -- the collision-detects-itself primitive
    // library.js's add() relies on instead of a separate read-then-write.
    add(value, key) {
      const r = new FakeRequest();
      this._tx._begin();
      schedule(r, () => {
        if (this._map.has(key)) {
          const err = new Error('Key already exists in the object store.');
          err.name = 'ConstraintError';
          throw err;
        }
        this._map.set(key, value);
        return key;
      }, ok => this._tx._settle(ok));
      return r;
    }
    delete(key) { const r = new FakeRequest(); this._tx._begin(); schedule(r, () => { this._map.delete(key); return undefined; }, ok => this._tx._settle(ok)); return r; }
    getAllKeys() { const r = new FakeRequest(); this._tx._begin(); schedule(r, () => Array.from(this._map.keys()), ok => this._tx._settle(ok)); return r; }
  }

  // Multiple requests can be issued against one transaction (library.js's
  // runTx does exactly that for its two-record writes), so completion has to
  // wait for every issued request to settle rather than firing on the
  // first -- otherwise oncomplete/onerror would fire multiple times, once
  // per request, which a real IndexedDB transaction never does.
  class FakeTransaction {
    constructor(store) { this._store = store; this.oncomplete = null; this.onerror = null; this.onabort = null; this._pending = 0; this._failed = false; this._done = false; }
    objectStore() { return new FakeObjectStore(this._store, this); }
    _begin() { this._pending++; }
    _settle(ok) {
      if (!ok) this._failed = true;
      this._pending--;
      if (this._pending === 0) {
        queueMicrotask(() => {
          if (this._done) return;
          this._done = true;
          if (this._failed) { if (this.onabort) this.onabort({ target: this }); if (this.onerror) this.onerror({ target: this }); }
          else if (this.oncomplete) this.oncomplete({ target: this });
        });
      }
    }
  }

  class FakeDatabase {
    constructor() { this._stores = new Map(); this.objectStoreNames = { contains: name => this._stores.has(name) }; }
    createObjectStore(name) { const map = new Map(); this._stores.set(name, map); return new FakeObjectStore(map, { _begin() {}, _settle() {} }); }
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

// ---- BC-08: add() must allocate the id and write both records atomically ----
//
// The fake schedules every store op through queueMicrotask (openDb, get,
// put, getAllKeys each add their own turn), so two `add()` calls started
// together genuinely interleave the way a real IndexedDB-backed library does
// -- unlike memoryStore, whose every op is synchronous and so never
// reproduces the race. This is what BC-08 was actually reproduced against.
test('add: two concurrent adds with the same preferred id get distinct ids and both are stored (BC-08)', async () => {
  const library = createLibrary(indexedDbStore(makeFakeIndexedDB(), 'bc08-db'));
  const [id1, id2] = await Promise.all([
    library.add(song('hot-cross-buns', { title: 'first' }), { now: 1000 }),
    library.add(song('hot-cross-buns', { title: 'second' }), { now: 2000 }),
  ]);
  assert.notEqual(id1, id2, 'two concurrent adds for the same preferred id must not collide on one id');
  const s1 = await library.get(id1);
  const s2 = await library.get(id2);
  assert.ok(s1, 'the first song must actually be stored');
  assert.ok(s2, 'the second song must actually be stored');
  assert.notEqual(s1.title, s2.title, 'both songs must survive, not one clobbering the other');
});

// A store whose transaction fails partway through, to prove add() leaves
// nothing behind rather than a dangling song record with no metadata (or
// vice versa) -- the failure mode BC-08 also named.
function faultyStoreFailingSecondWrite() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : undefined; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async keys() { return Array.from(map.keys()); },
    async runTx(ops) {
      // Simulates a transaction that aborts on its second write: nothing
      // from this call is ever applied to the map, matching what a real
      // IndexedDB transaction does when one of its requests fails.
      if (ops.length < 2) { for (const op of ops) map.set(op.key, op.value); return; }
      throw new Error('simulated write failure');
    },
  };
}

test('add: a failure partway through the transaction leaves neither record stored', async () => {
  const library = createLibrary(faultyStoreFailingSecondWrite());
  await assert.rejects(() => library.add(song('x'), { now: 1000 }), /simulated write failure/);
  assert.equal(await library.get('x'), null);
});

test('update: overwrites a stored song in place, keeping its id and original addedAt', async () => {
  const library = createLibrary(memoryStore());
  await library.add(song('a', { title: 'first cut' }), { now: 1000 });
  await library.update('a', song('a', { title: 'fixed up' }), { now: 5000 });
  const stored = await library.get('a');
  assert.equal(stored.title, 'fixed up');
  assert.equal(stored.id, 'a');
  const list = await library.list();
  assert.equal(list.length, 1, 'update must not create a second entry');
  assert.equal(list[0].addedAt, 1000, 'addedAt is preserved across an in-place update');
});

test('update: rejects an id that is not already stored', async () => {
  const library = createLibrary(memoryStore());
  await assert.rejects(() => library.update('missing', song('missing'), { now: 1000 }), /no song/);
});

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

// ---- a starter tune's id is reserved: a saved copy never lands under it ----
//
// Starters are shipped, never stored (the Songs list draws them from
// starterSongs). A stored song under a starter's id would sit next to the
// shipped starter with the same id, and every starter-first lookup by id
// (Practise this, Carry on) would open the starter instead of the copy.
// The set here is built from starterSongs directly, not from library.js's
// own export, so it is an independent check on what the library reserves.
const starterIdSet = new Set(starter.starterSongs.map((s) => s.id));

test('starter ids: the module exports the set of every starter song id', () => {
  assert.ok(starter.starterSongs.length > 0);
  assert.ok(starter.starterIds instanceof Set, 'starterIds is a Set');
  assert.deepEqual([...starter.starterIds].sort(), [...starterIdSet].sort());
});

test('add: a song carrying a starter tune\'s id is stored under a different id, for every starter', async () => {
  const library = createLibrary(memoryStore());
  let ran = 0;
  for (const s of starter.starterSongs) {
    const r = await library.add(song(s.id), { now: 1 });
    ran++;
    assert.notEqual(r, s.id, 'starter "' + s.id + '": the copy must not be stored under the starter\'s id');
    assert.ok(!starterIdSet.has(r), 'starter "' + s.id + '": "' + r + '" must not be another starter\'s id either');
    assert.equal((await library.get(r)).id, r, 'the stored copy carries the id it was stored under');
    assert.equal(await library.get(s.id), null, 'nothing is stored under the starter\'s id "' + s.id + '"');
  }
  assert.equal(ran, starter.starterSongs.length);
});

test('add: two copies of the same starter get two different non-starter ids, both retrievable', async () => {
  const library = createLibrary(memoryStore());
  const a = await library.add(song('hot-cross-buns', { title: 'first' }), { now: 1 });
  const b = await library.add(song('hot-cross-buns', { title: 'second' }), { now: 2 });
  assert.ok(!starterIdSet.has(a), 'the first copy\'s id "' + a + '" is not a starter id');
  assert.ok(!starterIdSet.has(b), 'the second copy\'s id "' + b + '" is not a starter id');
  assert.notEqual(a, b);
  assert.equal((await library.get(a)).title, 'first');
  assert.equal((await library.get(b)).title, 'second');
});

test('importAll: a song carrying a starter id is stored under another id; ordinary ids are kept', async () => {
  const library = createLibrary(memoryStore());
  const { ids } = await library.importAll([song('hot-cross-buns'), song('plain')]);
  assert.equal(ids.length, 2);
  assert.equal(ids[1], 'plain');
  assert.ok(!starterIdSet.has(ids[0]), 'the starter-id song got "' + ids[0] + '", not a starter id');
  const listed = (await library.list()).map((m) => m.id);
  assert.equal(listed.length, 2);
  assert.ok(listed.every((id) => !starterIdSet.has(id)), 'no stored song sits under a starter id: ' + listed.join(', '));
});

test('add: ids that are not starter ids are kept, and update keeps a copy\'s id (negative control)', async () => {
  const library = createLibrary(memoryStore());
  assert.equal(await library.add(song('plain'), { now: 1 }), 'plain');
  assert.ok(!starterIdSet.has('hot-cross-buns-2'), 'the control id is not a starter id');
  assert.equal(await library.add(song('hot-cross-buns-2'), { now: 1 }), 'hot-cross-buns-2');
  const r = await library.add(song('hot-cross-buns'), { now: 1 });
  await library.update(r, song('x', { title: 'edited' }), { now: 2 });
  assert.equal((await library.get(r)).title, 'edited');
  assert.equal((await library.get(r)).id, r);
});
