// Pins the PWA auto-update claim relied on elsewhere: "the Pages/PWA edition
// auto-updates, because sw.js is a versioned cache-first service worker and a
// new deploy supersedes the old cache." That is only true if (a) two
// different app versions actually get two different cache names, and (b) the
// worker's own activate handler deletes caches left over from older
// versions. A string match on the source proves neither -- it can pass on
// code whose activate handler is wired wrong or never runs. This exercises
// the generated sw.js by evaluating it against a fake `self`/`caches`, the
// same shape a real ServiceWorkerGlobalScope gives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceWorkerSource, CACHE_PREFIX } from '../../build/pages.mjs';

// A minimal fake of the CacheStorage + ServiceWorkerGlobalScope surface the
// generated sw.js touches in its install/activate handlers: caches.open,
// caches.keys, caches.delete, self.addEventListener, self.skipWaiting,
// self.clients.claim. Event listeners are captured by type so the test can
// invoke 'activate' directly, the way the browser would on a new worker
// taking over.
function makeFakeWorkerScope(existingCacheNames) {
  const listeners = {};
  const caches = new Map(existingCacheNames.map((name) => [name, { addAll: async () => {} }]));
  const deleted = [];
  const fakeCaches = {
    open: async (name) => {
      if (!caches.has(name)) caches.set(name, { addAll: async () => {} });
      return caches.get(name);
    },
    keys: async () => [...caches.keys()],
    delete: async (name) => {
      deleted.push(name);
      return caches.delete(name);
    },
  };
  const self = {
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: { scope: 'https://example.test/band-coach/' },
    location: { origin: 'https://example.test' },
  };
  return { self, caches: fakeCaches, listeners, deleted, cacheNames: () => [...caches.keys()] };
}

// event.waitUntil just needs to await whatever promise the handler passes it
// so the test can wait for the async activate work to settle.
function fireEvent(listener, self) {
  return new Promise((resolve, reject) => {
    const event = { waitUntil: (p) => Promise.resolve(p).then(resolve, reject) };
    listener.call(self, event);
  });
}

function loadWorker(version, { existingCacheNames = [] } = {}) {
  const src = buildServiceWorkerSource(version);
  const scope = makeFakeWorkerScope(existingCacheNames);
  const fn = new Function('self', 'caches', `${src}\nreturn { self, caches };`);
  fn(scope.self, scope.caches);
  return scope;
}

test('two different package versions produce two different cache names', () => {
  const srcA = buildServiceWorkerSource('1.2.3');
  const srcB = buildServiceWorkerSource('1.2.4');
  const nameA = srcA.match(/const CACHE_NAME = (".*");/)[1];
  const nameB = srcB.match(/const CACHE_NAME = (".*");/)[1];
  assert.notEqual(nameA, nameB, 'a version bump must change the cache name');
});

test('the current cache name actually contains the current version', () => {
  const version = '9.8.7';
  const src = buildServiceWorkerSource(version);
  const match = src.match(/const CACHE_NAME = (".*");/);
  assert.ok(match, 'sw.js declares CACHE_NAME');
  const name = JSON.parse(match[1]);
  assert.equal(name, CACHE_PREFIX + version, 'cache name is the prefix plus the exact current version');
  assert.ok(name.includes(version), 'cache name string contains the version');
});

test('activate deletes caches under CACHE_PREFIX left over from older versions', async () => {
  const oldVersion = '1.0.0';
  const newVersion = '2.0.0';
  const oldCacheName = CACHE_PREFIX + oldVersion;
  const scope = loadWorker(newVersion, { existingCacheNames: [oldCacheName] });

  assert.ok(scope.listeners.install, 'sw.js registers an install listener');
  assert.ok(scope.listeners.activate, 'sw.js registers an activate listener');
  // The real lifecycle: install opens/populates the new version's cache
  // first, then activate runs and should clean up what install superseded.
  await fireEvent(scope.listeners.install, scope.self);
  await fireEvent(scope.listeners.activate, scope.self);

  assert.deepEqual(scope.deleted, [oldCacheName], 'activate deleted exactly the superseded cache');
  assert.deepEqual(scope.cacheNames(), [CACHE_PREFIX + newVersion], 'only the current cache remains');
});

test('activate never deletes the current cache, and leaves caches outside the prefix alone', async () => {
  const version = '3.0.0';
  const currentCacheName = CACHE_PREFIX + version;
  const foreignCacheName = 'some-other-app-cache-v1'; // not ours to touch
  const scope = loadWorker(version, { existingCacheNames: [currentCacheName, foreignCacheName] });

  await fireEvent(scope.listeners.activate, scope.self);

  assert.deepEqual(scope.deleted, [], 'nothing needed deleting: no superseded band-coach cache existed');
  assert.deepEqual(
    scope.cacheNames().sort(),
    [currentCacheName, foreignCacheName].sort(),
    'the current cache and an unrelated cache both survive activation'
  );
});

test('activate deletes several superseded band-coach caches at once, e.g. after a skipped update', async () => {
  const newVersion = '5.0.0';
  const stale1 = CACHE_PREFIX + '3.0.0';
  const stale2 = CACHE_PREFIX + '4.0.0';
  const scope = loadWorker(newVersion, { existingCacheNames: [stale1, stale2] });

  await fireEvent(scope.listeners.install, scope.self);
  await fireEvent(scope.listeners.activate, scope.self);

  assert.deepEqual(scope.deleted.sort(), [stale1, stale2].sort(), 'both superseded caches are cleaned up');
  assert.deepEqual(scope.cacheNames(), [CACHE_PREFIX + newVersion]);
});
