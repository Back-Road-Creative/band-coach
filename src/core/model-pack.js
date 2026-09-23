// A "model pack" is an optional, larger asset -- an instrument or voice
// model a later unit will offer -- deliberately kept OUT of the one
// downloadable band-coach.html: baking it in would grow the file everyone
// downloads even for people who never touch the feature it powers. Instead
// it is hosted for free on the same GitHub Pages site update-check.js
// already talks to (see src/core/update-check.js and D2 in the product
// plan), and every byte of it is fetched only on a learner's press -- never
// on load, never on a timer, never speculatively. This module is the pure
// seam for that: fetch, storage and the checksum digest are all injected, so
// a cache hit, a corrupt download, a version bump and a failed upgrade are
// all provable without a browser or a real network. The IndexedDB adapter
// lives here too (browsers only, exercised by a characterization test) so a
// caller need not reach into a second file to get a real cache.
//
// A model pack lives at `<pages root>/model-packs/<name>/manifest.json`,
// mirroring VERSION_CHECK_URL's placement at the Pages root (see
// update-check.js) -- but unlike the version check, which has exactly one
// fixed target, a caller can offer more than one pack, so `loadPack` takes
// `manifestUrl` directly rather than assuming a single constant. This
// constant is the shared PREFIX a later UI unit builds pack URLs from, kept
// here so the URL scheme has one home instead of being invented again at
// the call site.
export const MODEL_PACK_BASE_URL = 'https://back-road-creative.github.io/band-coach/model-packs/';

// A manifest fetched from `manifestUrl` is expected to look like:
//   { "name": "...", "version": "1.0.0", "bytes": 12345,
//     "sha256": "<hex>", "url": "https://.../pack.bin" }
// `loadPack` never assumes any field is present beyond what it needs -- a
// malformed manifest simply fails the same way a network error does (the
// fetch/parse throws and this rejects), since "couldn't get the manifest"
// and "the manifest didn't fetch" are the same answer to the learner: try
// again later.
//
// Cache semantics: a hit is (cached pack has the SAME name, version AND
// sha256 as the manifest currently reports) -- so a manifest whose bytes
// changed under an unchanged version number is treated as a miss rather
// than silently served stale, and nothing is ever cached until its checksum
// has been verified against the manifest's own claim.
export async function loadPack({ manifestUrl, fetchImpl, store, digest = sha256Hex, inFlight } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation was supplied to loadPack');
  if (!store) throw new Error('no store was supplied to loadPack');

  const manifestRes = await fetchImpl(manifestUrl);
  if (!manifestRes || !manifestRes.ok) throw new Error(`could not reach the model-pack manifest at ${manifestUrl}`);
  const manifest = await manifestRes.json();
  const name = manifest && manifest.name;
  if (!name) throw new Error('model-pack manifest is missing its name');

  const cached = await store.get(name);
  if (cached && cached.version === manifest.version && cached.sha256 === manifest.sha256) {
    return { name, version: cached.version, sha256: cached.sha256, bytes: cached.bytes, fromCache: true };
  }

  if (inFlight) inFlight.add(name);
  try {
    const fileRes = await fetchImpl(manifest.url);
    if (!fileRes || !fileRes.ok) throw new Error(`could not download the model pack "${name}"`);
    const buf = await fileRes.arrayBuffer();
    const actualSha = await digest(buf);
    if (actualSha !== manifest.sha256) {
      // Nothing is ever written to `store` on a mismatch -- an existing
      // cached copy (if any) is left exactly as it was, per the module's
      // contract above.
      throw new Error(
        `checksum mismatch downloading "${name}": expected ${manifest.sha256}, got ${actualSha}. Nothing was cached.`,
      );
    }
    const entry = { name, version: manifest.version, sha256: actualSha, bytes: buf };
    await store.set(name, entry);
    return { ...entry, fromCache: false };
  } finally {
    if (inFlight) inFlight.delete(name);
  }
}

// A UI's-eye view of one pack, ahead of any press: 'absent' (never
// downloaded), 'cached' (a usable copy already sits in `store`, at
// `version`), or 'downloading' (a `loadPack` call for this pack is in
// flight right now, per the same `inFlight` set `loadPack` was given). The
// three states are mutually exclusive by construction here -- downloading
// is checked first, so a caller can never see "absent" for a pack whose
// first-ever download just started, only "downloading".
export async function packStatus({ store, packName, inFlight } = {}) {
  if (inFlight && inFlight.has(packName)) return { state: 'downloading', name: packName };
  const cached = await store.get(packName);
  if (!cached) return { state: 'absent', name: packName };
  return { state: 'cached', name: packName, version: cached.version };
}

// The simplest possible store: good enough for tests and for a caller that
// wants no persistence at all. Keys and values are held exactly as given --
// no serialization -- so a caller never needs to worry about this adapter
// mangling an ArrayBuffer.
export function createMemoryStore() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

// Real persistence for a browser: one object store, keyed by pack name, each
// value the same shape `loadPack` writes ({ name, version, sha256, bytes }).
// Returns null when there is no indexedDB at all (a caller feature-detects
// by checking the return value, never by browser-sniffing) rather than
// throwing, since a missing IndexedDB is a capability gap this module must
// report truthfully, not a fatal error.
export function createIndexedDBStore({
  dbName = 'band-coach-model-packs',
  storeName = 'packs',
  indexedDB: idbOverride,
} = {}) {
  const idb = idbOverride || (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  if (!idb) return null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async get(key) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

// Hex-encodes a SHA-256 digest of `buf` (an ArrayBuffer). `subtle` defaults
// to the real global `crypto.subtle` but is a parameter so a test can supply
// a fake one and prove the hex-encoding logic without depending on the real
// algorithm running correctly.
export async function sha256Hex(buf, subtle) {
  const impl = subtle || (typeof crypto !== 'undefined' && crypto.subtle);
  if (!impl) throw new Error('no SubtleCrypto implementation is available to hash this download');
  const hash = await impl.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
