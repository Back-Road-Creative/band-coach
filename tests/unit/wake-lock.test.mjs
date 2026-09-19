import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWakeLock } from '../../src/ui/wake-lock.js';

function fakeSentinel() {
  const listeners = {};
  return {
    released: false,
    addEventListener(name, fn) { listeners[name] = fn; },
    async release() { this.released = true; if (listeners.release) listeners.release(); },
  };
}

function fakeNavigator(sentinelFactory) {
  const calls = [];
  return {
    calls,
    wakeLock: {
      request: async (kind) => { calls.push(kind); return sentinelFactory(); },
    },
  };
}

test('acquire requests a screen wake lock exactly once', async () => {
  const nav = fakeNavigator(fakeSentinel);
  const wl = createWakeLock({ navigator: nav });
  await wl.acquire();
  assert.deepEqual(nav.calls, ['screen']);
});

test('release lets go of the sentinel', async () => {
  let sentinel;
  const nav = fakeNavigator(() => (sentinel = fakeSentinel()));
  const wl = createWakeLock({ navigator: nav });
  await wl.acquire();
  await wl.release();
  assert.equal(sentinel.released, true);
  assert.equal(wl.isActive(), false);
});

test('missing navigator.wakeLock is a silent no-op, never throws', async () => {
  const wl = createWakeLock({ navigator: {} });
  await assert.doesNotReject(wl.acquire());
  await assert.doesNotReject(wl.release());
});

test('no navigator at all (worst case) is still a silent no-op', async () => {
  const wl = createWakeLock({ navigator: undefined });
  await assert.doesNotReject(wl.acquire());
});

test('handleVisibilityChange re-acquires when the tab becomes visible again and a lock is wanted', async () => {
  const nav = fakeNavigator(fakeSentinel);
  const wl = createWakeLock({ navigator: nav });
  await wl.acquire();
  assert.equal(nav.calls.length, 1);
  await wl.handleVisibilityChange({ visibilityState: 'visible' });
  // sentinel already held and visible -> no redundant re-request
  assert.equal(nav.calls.length, 1);
});

test('handleVisibilityChange re-acquires after the OS silently released the lock (e.g. minimized)', async () => {
  let sentinel;
  const nav = fakeNavigator(() => (sentinel = fakeSentinel()));
  const wl = createWakeLock({ navigator: nav });
  await wl.acquire();
  await sentinel.release(); // OS-driven release fires the sentinel's own 'release' event
  await wl.handleVisibilityChange({ visibilityState: 'visible' });
  assert.equal(nav.calls.length, 2);
});

test('handleVisibilityChange does nothing while the tab is hidden', async () => {
  let sentinel;
  const nav = fakeNavigator(() => (sentinel = fakeSentinel()));
  const wl = createWakeLock({ navigator: nav });
  await wl.acquire();
  await sentinel.release();
  await wl.handleVisibilityChange({ visibilityState: 'hidden' });
  assert.equal(nav.calls.length, 1);
});

test('handleVisibilityChange does nothing when no session ever asked for a lock', async () => {
  const nav = fakeNavigator(fakeSentinel);
  const wl = createWakeLock({ navigator: nav });
  await wl.handleVisibilityChange({ visibilityState: 'visible' });
  assert.equal(nav.calls.length, 0);
});

test('a request() rejection (permission denied) is swallowed, not thrown', async () => {
  const nav = { wakeLock: { request: async () => { throw new Error('nope'); } } };
  const wl = createWakeLock({ navigator: nav });
  await assert.doesNotReject(wl.acquire());
});
