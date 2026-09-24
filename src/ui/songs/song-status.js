// Pure helpers for the "is this song a Draft or Checked" ledger Songs keeps
// in api.store('song-status') (plain object in DB.panels['song-status'],
// same shape/limit rule as api.store('songs-progress') -- see
// mountSongsPanel's progressStore in src/ui/songs.js). Every song saved
// through Add a song (plan P3-4/P3-5) is a Draft the moment it lands, since
// today's import/learn flows already save before review (learn.js:280,
// :338; songs.js:1286) -- this just gives that state a name and a plain
// label instead of silently forgetting it.
//
// No DOM, no api.store here: every function takes a ledger and returns one
// (or reads it), so the panel owns the only api.store('song-status').get()/
// .set() calls and this file stays trivially unit-testable.

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Drops anything that is not a plain object, a key that is not a safe song
// id, or an entry that is not itself a plain object -- same "clean, don't
// throw" rule as src/ui/panels.js's sanitizePanelData, so one broken ledger
// entry (a stray key, a corrupted save) can never stop Songs from loading.
export function sanitizeStatusLedger(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach((id) => {
    if (UNSAFE_KEYS.has(id) || !ID_RE.test(id)) return;
    const entry = raw[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    out[id] = {
      draft: !!entry.draft,
      needsCheck: Number.isFinite(entry.needsCheck) ? entry.needsCheck : 0,
      source: typeof entry.source === 'string' ? entry.source : '',
      originalAudioKept: entry.originalAudioKept !== false,
    };
  });
  return out;
}

// Records a freshly-saved song as a Draft. `needsCheck` is the count of
// flagged notes reviewGate() below will block practice on; `source` is a
// plain tag ('file' | 'mic', left to the caller) and `originalAudioKept` is
// always false today (songs cannot keep audio -- normalizeSong strips
// unknown fields, and the library caps a song at 5 MB, library.js:19/:125),
// kept here so the label can say so plainly rather than pretending.
export function markDraft(ledger, songId, { needsCheck = 0, source = '', originalAudioKept = false } = {}) {
  const out = { ...(ledger || {}) };
  out[songId] = { draft: true, needsCheck: needsCheck || 0, source, originalAudioKept: !!originalAudioKept };
  return out;
}

// Marks a song reviewed: clears the draft flag and the open-checks count,
// keeping its source/originalAudioKept fields.
export function markChecked(ledger, songId) {
  const out = { ...(ledger || {}) };
  const prev = out[songId] || { source: '', originalAudioKept: false };
  out[songId] = { ...prev, draft: false, needsCheck: 0 };
  return out;
}

export function statusFor(ledger, songId) {
  if (!ledger || typeof ledger !== 'object') return null;
  return ledger[songId] || null;
}

// Plain-words label for a status entry, e.g. "Draft — 3 notes to check" or
// "Checked". Appends the honest "Original recording not kept" note (plan §4
// risk 4) whenever the entry says the original was not kept, on both a
// Draft and a Checked song.
export function statusLabel(entry) {
  if (!entry) return '';
  let label;
  if (entry.draft) {
    const n = entry.needsCheck || 0;
    label = n > 0 ? 'Draft — ' + n + ' note' + (n === 1 ? '' : 's') + ' to check' : 'Draft';
  } else {
    label = 'Checked';
  }
  if (entry.originalAudioKept === false) label += ' — Original recording not kept';
  return label;
}

// Removes a song's status entry (called when a song is deleted from the
// library elsewhere, so the ledger never drifts to point at a song that no
// longer exists -- plan §4 risk 5).
export function forgetSong(ledger, songId) {
  const out = { ...(ledger || {}) };
  delete out[songId];
  return out;
}

// A copy of learn.js's practiceGate rule (learn.js:90-94): a song with any
// open flagged notes cannot be practised until they are resolved. Kept as
// its own copy here, not an import, so src/ui/learn.js stays untouched by
// this unit (tests/unit/learn-source.test.mjs and every learn.js
// characterization test are unaffected).
export function reviewGate(warnings) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return { allowed: true, reason: null };
  return { allowed: false, reason: 'Fix up the ' + list.length + ' flagged note' + (list.length === 1 ? '' : 's') + ' first, then practise.' };
}
