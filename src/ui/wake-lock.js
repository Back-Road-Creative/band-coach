// Screen Wake Lock wiring (unit 7.7 item 7 / plan E10): hands are on the
// instrument during an exercise, not the keyboard or the touchscreen, so the
// OS's normal idle-sleep timer has nothing to reset it with. Requests a
// 'screen' wake lock for the length of a practice session and lets it go
// when the session ends.
//
// `navigator` is injectable so this is unit-testable without a browser; the
// real caller passes nothing and gets the global. Where the API does not
// exist (unsupported browser, or a non-secure context such as some file://
// origins) every method is a silent no-op — never throws, never blocks the
// exercise loop.
export function createWakeLock(deps = {}) {
  const nav = 'navigator' in deps ? deps.navigator : typeof navigator !== 'undefined' ? navigator : undefined;
  let sentinel = null;
  let active = false;
  // Bumped on every acquire()/release() so an in-flight request() can tell,
  // once it resolves, whether it is still the one the caller wants. A slow
  // grant that lands after the session ended (or after a newer acquire()
  // superseded it) is released immediately instead of being stored — the
  // OS-visible lock must never outlive the request that asked for it.
  let generation = 0;

  function supported() {
    return !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  }

  async function releaseSentinel(s) {
    if (s && typeof s.release === 'function') {
      try {
        await s.release();
      } catch (e) {
        // already released, or the platform refused it — nothing more to do
      }
    }
  }

  async function acquire() {
    active = true;
    const myGeneration = ++generation;
    if (!supported()) return null;
    try {
      const s = await nav.wakeLock.request('screen');
      if (myGeneration !== generation) {
        // superseded by a release() or another acquire() while this request
        // was pending — the grant still arrived, so let it go rather than
        // orphan it (screen would otherwise stay awake indefinitely).
        await releaseSentinel(s);
        return null;
      }
      sentinel = s || null;
      if (sentinel && typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
      }
    } catch (e) {
      sentinel = null;
    }
    return sentinel;
  }

  async function release() {
    active = false;
    generation++;
    const s = sentinel;
    sentinel = null;
    await releaseSentinel(s);
  }

  async function handleVisibilityChange(doc) {
    if (!active || sentinel) return;
    if (doc && doc.visibilityState !== 'visible') return;
    await acquire();
  }

  return {
    acquire,
    release,
    handleVisibilityChange,
    isActive: () => active,
    sentinel: () => sentinel,
  };
}
