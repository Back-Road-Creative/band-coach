// Song library: CRUD over an injected async key-value store, plus an
// IndexedDB adapter for the browser and an in-memory one for tests.
// Wiring pass:
//   const library = createLibrary(indexedDbStore(window.indexedDB, 'bandcoach-songs'));
//   library.list() -> metadata only, for a song picker; library.get(id) -> full Song or null;
//   library.add(song, { now: Date.now() }); library.rename(id, title); library.remove(id);
//   library.exportAll()/importAll(json) -> backup/restore.
// `store` must implement get(key)/put(key,value)/delete(key)/keys() (all Promise-returning), plus
// runTx(ops) — ops is [{ op: 'add'|'put'|'delete', key, value }], applied as one atomic unit:
// an 'add' whose key already exists throws (code 'KEY_EXISTS') and rolls back every op in the
// same call; any other failure also rolls back the whole call. Both memoryStore and
// indexedDbStore below implement it.
// No DOM, no globals, no randomness, no clock reads here: `now` is always caller-supplied.

import { normalizeSong, songDurationTicks, ticksToSeconds } from './model.js';

const SONG_PREFIX = 'song:';
const META_PREFIX = 'meta:';
const MAX_SONG_BYTES = 5 * 1024 * 1024;

function songKey(id) {
  return SONG_PREFIX + id;
}

function metaKey(id) {
  return META_PREFIX + id;
}

function byteLength(str) {
  // Avoids a hard dependency on Buffer/TextEncoder specifics beyond what
  // both Node and browsers provide.
  return new TextEncoder().encode(str).length;
}

function metaFrom(song, addedAt) {
  const durationTicks = songDurationTicks(song);
  return {
    id: song.id,
    title: song.title,
    addedAt,
    durationTicks,
    durationSeconds: ticksToSeconds(durationTicks, song.bpm)
  };
}

// Wraps `store` (get/put/delete/keys) into the library API described above.
export function createLibrary(store) {
  return {
    // List of { id, title, addedAt, durationTicks, durationSeconds } for
    // every stored song. No note data is read or returned.
    async list() {
      const keys = await store.keys();
      const metaKeys = keys.filter(k => k.startsWith(META_PREFIX));
      const metas = [];
      for (const key of metaKeys) {
        const meta = await store.get(key);
        if (meta) metas.push(meta);
      }
      return metas;
    },

    // Full Song object for `id`, or null if it does not exist.
    async get(id) {
      const song = await store.get(songKey(id));
      return song || null;
    },

    // Validates and stores `song`. If `song.id` clashes with a stored song,
    // a new id is assigned (song-2, song-3, ...) and the assigned id is
    // returned. `now` (a timestamp, e.g. Date.now() from the caller) is
    // required since this module never reads the clock itself.
    //
    // The id and both records (song + metadata) are allocated in one
    // store.runTx call per attempt: 'add' throws instead of overwriting on a
    // collision, so there is no read-then-decide window for two concurrent
    // calls to both observe the same free id (BC-08) -- the store itself is
    // the single source of truth for "is this id taken", checked and claimed
    // atomically. A collision retries with the next suffix; any other
    // failure propagates with nothing stored (store.runTx rolls back the
    // whole attempt).
    async add(song, { now } = {}) {
      if (!Number.isFinite(now)) {
        throw new Error('add() requires a numeric `now` timestamp');
      }
      const normalized = normalizeSong(song);
      const serialized = JSON.stringify(normalized);
      if (byteLength(serialized) > MAX_SONG_BYTES) {
        throw new Error('song "' + normalized.title + '" is too large to store (over 5 MB)');
      }
      let id = normalized.id;
      let n = 2;
      for (;;) {
        const stored = id === normalized.id ? normalized : { ...normalized, id };
        try {
          await store.runTx([
            { op: 'add', key: songKey(id), value: stored },
            { op: 'add', key: metaKey(id), value: metaFrom(stored, now) },
          ]);
          return id;
        } catch (e) {
          if (e && e.code === 'KEY_EXISTS') {
            id = normalized.id + '-' + n;
            n++;
            continue;
          }
          throw e;
        }
      }
    },

    // Overwrites a stored song IN PLACE, keeping its id and its original
    // addedAt (so "correct a mistake and save again" from the editor updates
    // the one song a learner is looking at instead of leaving a trail of
    // suffixed copies). Throws if `id` is not already stored -- callers that
    // want "always create a new entry" should use add() instead.
    async update(id, song, { now } = {}) {
      if (!Number.isFinite(now)) {
        throw new Error('update() requires a numeric `now` timestamp');
      }
      const existingMeta = await store.get(metaKey(id));
      if (!existingMeta) throw new Error('no song with id "' + id + '"');
      const normalized = normalizeSong({ ...song, id });
      const serialized = JSON.stringify(normalized);
      if (byteLength(serialized) > MAX_SONG_BYTES) {
        throw new Error('song "' + normalized.title + '" is too large to store (over 5 MB)');
      }
      const meta = { ...metaFrom(normalized, existingMeta.addedAt), updatedAt: now };
      await store.runTx([
        { op: 'put', key: songKey(id), value: normalized },
        { op: 'put', key: metaKey(id), value: meta },
      ]);
    },

    // Renames a stored song's title. Throws if the id does not exist.
    async rename(id, newTitle) {
      const song = await store.get(songKey(id));
      if (!song) throw new Error('no song with id "' + id + '"');
      if (typeof newTitle !== 'string' || newTitle.length === 0) {
        throw new Error('newTitle must be a non-empty string');
      }
      const renamed = { ...song, title: newTitle };
      const meta = await store.get(metaKey(id));
      await store.put(songKey(id), renamed);
      await store.put(metaKey(id), { ...meta, title: newTitle });
    },

    // Removes a stored song and its metadata. No error if it did not exist.
    async remove(id) {
      await store.delete(songKey(id));
      await store.delete(metaKey(id));
    },

    // Every stored song's full data, for backup. Returns a plain array
    // (JSON.stringify it yourself if you need text).
    async exportAll() {
      const keys = await store.keys();
      const songKeys = keys.filter(k => k.startsWith(SONG_PREFIX));
      const songs = [];
      for (const key of songKeys) {
        const song = await store.get(key);
        if (song) songs.push(song);
      }
      return songs;
    },

    // Restores songs from exportAll()'s output (an array, or a JSON string
    // of one). Each song is validated and, on an id clash, given a new id
    // rather than overwriting what is already stored. Returns
    // { imported: number, ids: string[] }.
    async importAll(json) {
      const songs = typeof json === 'string' ? JSON.parse(json) : json;
      if (!Array.isArray(songs)) {
        throw new Error('importAll expects an array of songs (or a JSON string of one)');
      }
      const ids = [];
      for (const song of songs) {
        const id = await this.add(song, { now: Date.now() });
        ids.push(id);
      }
      return { imported: ids.length, ids };
    }
  };
}

// A plain in-memory store for tests and quick scripting. Not persistent.
export function memoryStore() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : undefined;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async keys() {
      return Array.from(map.keys());
    },
    // Validates every 'add' op against the CURRENT map before applying any
    // of them, so a collision on one op never leaves an earlier op's write
    // behind -- this function has no `await` in its body, so (being an
    // async function) it runs to completion synchronously once called,
    // leaving no gap for a second concurrent add() to observe a half-applied
    // transaction.
    async runTx(ops) {
      for (const { op, key } of ops) {
        if (op === 'add' && map.has(key)) {
          const err = new Error('key "' + key + '" already exists');
          err.code = 'KEY_EXISTS';
          throw err;
        }
      }
      for (const { op, key, value } of ops) {
        if (op === 'add' || op === 'put') map.set(key, value);
        else if (op === 'delete') map.delete(key);
      }
    }
  };
}

// An IndexedDB-backed store. `idbFactory` is the `indexedDB` object itself
// (e.g. `window.indexedDB`), passed in explicitly so this module never
// touches a global. Uses a single object store named "kv" keyed by the
// caller's string keys.
export function indexedDbStore(idbFactory, dbName) {
  const STORE_NAME = 'kv';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = idbFactory.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('failed to open IndexedDB database "' + dbName + '"'));
    });
  }

  async function runRequest(mode, makeRequest) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = makeRequest(store);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  return {
    async get(key) {
      return runRequest('readonly', store => store.get(key));
    },
    async put(key, value) {
      await runRequest('readwrite', store => store.put(value, key));
    },
    async delete(key) {
      await runRequest('readwrite', store => store.delete(key));
    },
    async keys() {
      return runRequest('readonly', store => store.getAllKeys());
    },
    // Runs every op in `ops` inside ONE IndexedDB readwrite transaction, so
    // they commit or abort together. 'add' requests use IDBObjectStore.add,
    // which raises a ConstraintError (rather than silently overwriting) when
    // the key already exists -- exactly the failure library.js's add()
    // retries on. Any other request failure also aborts the transaction
    // (IndexedDB's own default: an unhandled request error aborts its
    // transaction), so a forced failure on one write leaves nothing from
    // this call stored.
    async runTx(ops) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        let keyExists = null;
        ops.forEach(({ op, key, value }) => {
          let request;
          if (op === 'add') request = store.add(value, key);
          else if (op === 'put') request = store.put(value, key);
          else if (op === 'delete') request = store.delete(key);
          else throw new Error('runTx: unknown op "' + op + '"');
          request.onerror = () => {
            if (op === 'add' && request.error && request.error.name === 'ConstraintError') {
              keyExists = key;
            }
          };
        });
        tx.oncomplete = () => resolve();
        const onFailure = () => {
          if (keyExists) {
            const err = new Error('key "' + keyExists + '" already exists');
            err.code = 'KEY_EXISTS';
            reject(err);
          } else {
            reject(tx.error || new Error('IndexedDB transaction failed'));
          }
        };
        tx.onerror = onFailure;
        tx.onabort = onFailure;
      });
    }
  };
}
