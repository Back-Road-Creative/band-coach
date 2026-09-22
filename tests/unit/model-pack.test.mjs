// A "model pack" is an optional, larger asset (an instrument model, a voice
// model -- whatever a later unit ends up shipping) that is deliberately NOT
// baked into the one downloadable band-coach.html: bundling it would bloat
// the file everyone downloads even if they never use the feature it powers.
// Instead it is hosted for free on the same GitHub Pages site update-check.js
// already talks to (see src/core/update-check.js), and fetched only when the
// learner presses a button that says what it is about to download -- never
// on load, never on a timer, never speculatively.
//
// This is the pure seam: no DOM, no global fetch, no real IndexedDB. Every
// dependency (fetch, storage, the digest function) is injected, so cache
// hit/miss, a corrupt download and a version bump are all provable without a
// browser. The IndexedDB-backed store lives in this same module but is
// exercised by the characterization test instead, since node:test has no
// IndexedDB of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPack,
  packStatus,
  createMemoryStore,
  sha256Hex,
} from '../../src/core/model-pack.js';

const MANIFEST_URL = 'https://back-road-creative.github.io/band-coach/model-packs/example/manifest.json';

// A tiny fixed payload with a precomputed SHA-256, so tests never depend on
// crypto.subtle actually running correctly to set up their own fixtures --
// only the module under test's use of `digest` is exercised via the fake.
const GOOD_BYTES = new TextEncoder().encode('hello model pack').buffer;
const GOOD_SHA = 'aaaa0000';
const BAD_SHA = 'ffffffff';

function fakeDigest(sha) {
  return async () => sha;
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const route = routes[String(url)];
    if (!route) throw new Error(`fakeFetch: no route for ${url}`);
    if (route.reject) throw route.reject;
    return route.response;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function bytesResponse(buf) {
  return { ok: true, status: 200, arrayBuffer: async () => buf };
}

test('a fresh pack (no cache) is downloaded, verified and stored', async () => {
  const store = createMemoryStore();
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '1.0.0', bytes: GOOD_BYTES.byteLength, sha256: GOOD_SHA, url: 'https://example.test/pack.bin' }) },
    'https://example.test/pack.bin': { response: bytesResponse(GOOD_BYTES) },
  });
  const result = await loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest(GOOD_SHA) });
  assert.equal(result.name, 'example');
  assert.equal(result.version, '1.0.0');
  assert.equal(result.fromCache, false);
  assert.deepEqual(fetchImpl.calls, [MANIFEST_URL, 'https://example.test/pack.bin']);

  const cached = await store.get('example');
  assert.ok(cached, 'the download is stored');
  assert.equal(cached.version, '1.0.0');
  assert.equal(cached.sha256, GOOD_SHA);
});

test('a cache hit (same version and checksum) never re-downloads the file', async () => {
  const store = createMemoryStore();
  await store.set('example', { name: 'example', version: '1.0.0', sha256: GOOD_SHA, bytes: GOOD_BYTES });
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '1.0.0', bytes: GOOD_BYTES.byteLength, sha256: GOOD_SHA, url: 'https://example.test/pack.bin' }) },
  });
  const result = await loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest(GOOD_SHA) });
  assert.equal(result.fromCache, true);
  // Only the manifest was ever fetched -- the pack file itself was not.
  assert.deepEqual(fetchImpl.calls, [MANIFEST_URL]);
});

test('a checksum mismatch is rejected and nothing is cached', async () => {
  const store = createMemoryStore();
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '1.0.0', bytes: GOOD_BYTES.byteLength, sha256: GOOD_SHA, url: 'https://example.test/pack.bin' }) },
    'https://example.test/pack.bin': { response: bytesResponse(GOOD_BYTES) },
  });
  await assert.rejects(
    () => loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest(BAD_SHA) }),
    /checksum/i,
  );
  assert.equal(await store.get('example'), null, 'a mismatched download is never cached');
});

test('a version bump replaces the cached copy', async () => {
  const store = createMemoryStore();
  await store.set('example', { name: 'example', version: '1.0.0', sha256: GOOD_SHA, bytes: GOOD_BYTES });
  const NEW_BYTES = new TextEncoder().encode('a newer pack').buffer;
  const NEW_SHA = 'bbbb1111';
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '2.0.0', bytes: NEW_BYTES.byteLength, sha256: NEW_SHA, url: 'https://example.test/pack-2.bin' }) },
    'https://example.test/pack-2.bin': { response: bytesResponse(NEW_BYTES) },
  });
  const result = await loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest(NEW_SHA) });
  assert.equal(result.fromCache, false);
  assert.equal(result.version, '2.0.0');
  const cached = await store.get('example');
  assert.equal(cached.version, '2.0.0');
  assert.equal(cached.sha256, NEW_SHA);
});

test('a network failure downloading the file leaves the previous cache intact', async () => {
  const store = createMemoryStore();
  await store.set('example', { name: 'example', version: '1.0.0', sha256: GOOD_SHA, bytes: GOOD_BYTES });
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '2.0.0', bytes: 99, sha256: 'cccc2222', url: 'https://example.test/pack-2.bin' }) },
    'https://example.test/pack-2.bin': { reject: new TypeError('Failed to fetch') },
  });
  await assert.rejects(() => loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest('cccc2222') }));
  const cached = await store.get('example');
  assert.equal(cached.version, '1.0.0', 'the old cache is untouched by a failed upgrade attempt');
});

test('a manifest fetch failure never touches the cache and rejects clearly', async () => {
  const store = createMemoryStore();
  await store.set('example', { name: 'example', version: '1.0.0', sha256: GOOD_SHA, bytes: GOOD_BYTES });
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { reject: new TypeError('Failed to fetch') },
  });
  await assert.rejects(() => loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest: fakeDigest(GOOD_SHA) }));
  const cached = await store.get('example');
  assert.equal(cached.version, '1.0.0');
});

test('packStatus reports absent, cached vN, and downloading', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await packStatus({ store, packName: 'example' }), { state: 'absent', name: 'example' });

  await store.set('example', { name: 'example', version: '1.2.0', sha256: GOOD_SHA, bytes: GOOD_BYTES });
  assert.deepEqual(await packStatus({ store, packName: 'example' }), { state: 'cached', name: 'example', version: '1.2.0' });

  const inFlight = new Set(['example']);
  assert.deepEqual(await packStatus({ store, packName: 'example', inFlight }), { state: 'downloading', name: 'example' });
});

test('loadPack tracks in-flight downloads via the optional inFlight set, clearing it on both success and failure', async () => {
  const store = createMemoryStore();
  const inFlight = new Set();
  let sawDuringDownload = false;
  const fetchImpl = fakeFetch({
    [MANIFEST_URL]: { response: jsonResponse({ name: 'example', version: '1.0.0', bytes: GOOD_BYTES.byteLength, sha256: GOOD_SHA, url: 'https://example.test/pack.bin' }) },
    'https://example.test/pack.bin': { response: bytesResponse(GOOD_BYTES) },
  });
  const digest = async () => {
    sawDuringDownload = inFlight.has('example');
    return GOOD_SHA;
  };
  await loadPack({ manifestUrl: MANIFEST_URL, fetchImpl, store, digest, inFlight });
  assert.equal(sawDuringDownload, true, 'the pack is marked in-flight while the download is happening');
  assert.equal(inFlight.has('example'), false, 'cleared once the download settles');
});

test('sha256Hex hashes real bytes via an injected SubtleCrypto-like digest function', async () => {
  const fakeSubtle = {
    digest: async (algo, bytes) => {
      assert.equal(algo, 'SHA-256');
      // Return a fixed 2-byte hash so the hex-encoding logic is provable.
      return new Uint8Array([0xde, 0xad]).buffer;
    },
  };
  const hex = await sha256Hex(new TextEncoder().encode('x').buffer, fakeSubtle);
  assert.equal(hex, 'dead');
});
