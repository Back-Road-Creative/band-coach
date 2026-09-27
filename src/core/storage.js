// Storage that never lies about whether it worked. `localStorage.setItem`
// throws on quota exhaustion and on some private-mode/disabled-storage
// configurations, but the OLD app.js write swallowed that in a bare
// `try {} catch (e) {}` -- so the app behaved as if the learner's progress
// was saved when it never landed anywhere. Some browsers are worse than
// that: they accept the call and report success, but silently write
// something OTHER than what was asked for (a stub value, a truncated
// string, nothing at all) -- an exception is not the only way a save can
// fail, so a bare try/catch would still be lying in that case. The only way
// to know a write actually took is to read it back and compare.
//
// safeSet/safeGet take `storage` as a parameter (never reach for the global
// `localStorage` themselves) so a unit test can hand them a fake Storage
// that throws on demand, with no browser and no jsdom required -- see
// tests/unit/storage.test.mjs.

// Writes `value` under `key`, then reads it back and compares before
// reporting success. Returns { ok: true } only once both the write AND the
// read-back have been verified to agree; otherwise { ok: false, reason }
// where `reason` is the thrown error's `.name` (e.g. 'QuotaExceededError',
// 'SecurityError') or 'mismatch' when the store accepted the write but
// returned something else back, or 'unknown' for an error with no name.
export function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (e) {
    return { ok: false, reason: (e && e.name) || 'unknown' };
  }
  let readBack;
  try {
    readBack = storage.getItem(key);
  } catch (e) {
    return { ok: false, reason: (e && e.name) || 'unknown' };
  }
  if (readBack !== value) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

// Reads `key` and JSON.parses it. `ok` is false only when the storage
// itself refused the READ (e.g. SecurityError in a locked-down context) --
// a missing key is still `ok: true` with `value: null`, since "nothing
// saved yet" is not a failure. `corrupt` is true when something WAS stored
// but JSON.parse could not read it: rather than discarding that raw text
// (as the old app.js's sanitizeDB path silently did), it is preserved
// verbatim under `${key}.corrupt` so a later recovery path has something to
// work with, instead of the learner's whole profile just vanishing with no
// trace it ever existed.
export function safeGet(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (e) {
    return { ok: false, value: null, corrupt: false };
  }
  if (raw === null || raw === undefined) return { ok: true, value: null, corrupt: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    try { storage.setItem(key + '.corrupt', raw); } catch (e2) { /* best-effort; nothing more we can do */ }
    return { ok: true, value: null, corrupt: true };
  }
  return { ok: true, value: parsed, corrupt: false };
}
