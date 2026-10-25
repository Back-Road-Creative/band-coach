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

// The store the app should use. In Chrome with all site data blocked (and some
// locked-down Safari setups) merely READING `window.localStorage` throws
// SecurityError, and some browsers hand back null -- so the global can never
// be passed as an argument (it is evaluated before any try the callee has).
// The read sits inside this try instead. When there is no real store the app
// still has to start, so it gets a throwaway in-memory stand-in and
// `blocked: true`, which the caller turns into the plain "could not be saved"
// line rather than pretending the progress is kept. `win` is a parameter so a
// unit test can hand over a fake window with a throwing getter.
export function getStorage(win) {
  try {
    const real = win.localStorage;
    if (real) return { storage: real, blocked: false };
  } catch (e) { /* blocked: fall through to the in-memory stand-in */ }
  const m = new Map();
  return { storage: { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }, blocked: true };
}

// Two tabs share one stored profile. `current` is what storage holds right
// now (null = nothing, undefined = the read threw), `lastStored` is the exact
// string this page last read or wrote. 'changed' means another tab wrote
// something this page has not seen: saving now would silently overwrite it, so
// the caller stops saving and asks for a reload. An empty key is nothing to
// clobber. A read that threw is 'unreadable': no proof, so no overwrite.
export function crossTabVerdict(current, lastStored) {
  if (current === undefined) return 'unreadable';
  if (current === null || current === lastStored) return 'ok';
  return 'changed';
}

// Reads `key` from `storage` and judges it against `lastStored`.
export function crossTabCheck(storage, key, lastStored) {
  let cur;
  try { cur = storage.getItem(key); } catch (e) { return 'unreadable'; }
  return crossTabVerdict(cur === undefined ? null : cur, lastStored);
}

// The exact text storage holds under `key` (null when nothing is stored or the read threw). Compared
// against, never parsed: a corrupt record or one with different whitespace must still equal itself.
export function readRaw(storage, key) {
  try { const raw = storage.getItem(key); return typeof raw === 'string' ? raw : null; } catch (e) { return null; }
}
