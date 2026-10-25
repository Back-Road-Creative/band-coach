// Pure helpers for "My speed" (leftovers plan F12): the learner's own tempo
// for a song, 50-100 % of the written tempo, and the best speed a counted
// Check of the whole piece came back clean at. Kept in api.store('songs-speed')
// as { 'songId|partId': { speed, best } } -- the panel owns the only
// .get()/.set() calls, same split as song-status.js.

export const MIN_SPEED = 50;
export const MAX_SPEED = 100;
export const SPEED_STEP = 5;
const MAX_ENTRIES = 200;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function validSpeed(v) {
  return Number.isFinite(v) && v >= MIN_SPEED && v <= MAX_SPEED ? Math.round(v / SPEED_STEP) * SPEED_STEP : null;
}

export function speedKey(songId, partId) { return songId + '|' + partId; }

// Clean, don't throw: a bad key, a non-object entry or an out-of-range speed
// is dropped, never trusted, so a corrupted save can't stop Songs loading.
export function sanitizeSpeedLedger(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).slice(0, MAX_ENTRIES).forEach((key) => {
    if (UNSAFE_KEYS.has(key)) return;
    const ids = key.split('|');
    if (ids.length !== 2 || !ids.every((id) => ID_RE.test(id))) return;
    const entry = raw[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const speed = validSpeed(entry.speed);
    const best = validSpeed(entry.best);
    if (speed === null && best === null) return;
    out[key] = { speed: speed === null ? MAX_SPEED : speed, best };
  });
  return out;
}

export function speedFor(ledger, key) {
  const entry = ledger && ledger[key];
  return entry ? entry.speed : MAX_SPEED;
}

export function withSpeed(ledger, key, speed) {
  const s = validSpeed(speed);
  if (s === null) return ledger;
  const prev = ledger[key] || { best: null };
  return { ...ledger, [key]: { ...prev, speed: s } };
}

// A counted, clean Check of the whole piece at `speed`. Returns the new
// ledger and, when it beat the old best (or there was none), the line to
// show: { speed, prev } with prev null the first time.
export function recordClean(ledger, key, speed) {
  const s = validSpeed(speed);
  const prev = ledger[key] ? ledger[key].best : null;
  if (s === null || (prev !== null && s <= prev)) return { ledger, record: null };
  const entry = ledger[key] || { speed: s };
  return { ledger: { ...ledger, [key]: { ...entry, best: s } }, record: { speed: s, prev } };
}

// The best clean speed any part of `songId` has, for the song list.
export function bestForSong(ledger, songId) {
  let best = null;
  Object.keys(ledger || {}).forEach((key) => {
    if (key.split('|')[0] === songId && ledger[key].best !== null && (best === null || ledger[key].best > best)) best = ledger[key].best;
  });
  return best;
}

// A step's bpm at the learner's speed. An untimed step (bpm 0) stays 0.
export function atSpeed(bpm, speed) {
  return bpm > 0 && speed < MAX_SPEED ? Math.max(1, Math.round(bpm * speed / 100)) : bpm;
}
