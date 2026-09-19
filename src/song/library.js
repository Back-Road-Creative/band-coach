// Song library: CRUD over an injected async key-value store, plus an
// IndexedDB adapter for the browser and an in-memory one for tests.
// Wiring pass:
//   const library = createLibrary(indexedDbStore(window.indexedDB, 'band-coach-songs'));
//   library.list() -> metadata only, for a song picker; library.get(id) -> full Song or null;
//   library.add(song, { now: Date.now() }); library.rename(id, title); library.remove(id);
//   library.exportAll()/importAll(json) -> backup/restore.
// `store` must implement get(key)/put(key,value)/delete(key)/keys() (all Promise-returning).
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
  async function existingIds() {
    const keys = await store.keys();
    return new Set(
      keys.filter(k => k.startsWith(SONG_PREFIX)).map(k => k.slice(SONG_PREFIX.length))
    );
  }

  // Appends -2, -3, ... until the id is free. Deterministic: no randomness,
  // no clock reads.
  async function freeId(preferredId, taken) {
    if (!taken.has(preferredId)) return preferredId;
    let n = 2;
    while (taken.has(preferredId + '-' + n)) n++;
    return preferredId + '-' + n;
  }

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
    async add(song, { now } = {}) {
      if (!Number.isFinite(now)) {
        throw new Error('add() requires a numeric `now` timestamp');
      }
      const normalized = normalizeSong(song);
      const serialized = JSON.stringify(normalized);
      if (byteLength(serialized) > MAX_SONG_BYTES) {
        throw new Error('song "' + normalized.title + '" is too large to store (over 5 MB)');
      }
      const taken = await existingIds();
      const id = await freeId(normalized.id, taken);
      const stored = id === normalized.id ? normalized : { ...normalized, id };
      await store.put(songKey(id), stored);
      await store.put(metaKey(id), metaFrom(stored, now));
      return id;
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
    }
  };
}
