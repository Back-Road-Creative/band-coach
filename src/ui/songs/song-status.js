// Pure helpers for the "is this song a Draft or Checked" ledger Songs keeps
// in api.store('song-status') (plain object in DB.panels['song-status'],
// same shape/limit rule as api.store('songs-progress') -- see
// mountSongsPanel's progressStore in src/ui/songs.js). Every song saved
// through Add a song (plan P3-4/P3-5) is a Draft the moment it lands, since
// today's import flows already save before review (onMicTake, importAudioFile,
// importNotationFile and importBandPack in src/ui/songs.js) -- this just gives
// that state a name and a plain label instead of silently forgetting it.
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
// keeping its source/originalAudioKept fields. `defaults` ({ source,
// originalAudioKept }) fills them in for a song with no ledger entry yet
// (a clean score import, which never passed through markDraft).
export function markChecked(ledger, songId, defaults) {
  const out = { ...(ledger || {}) };
  const prev = out[songId] || { source: '', originalAudioKept: false, ...(defaults || {}) };
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
    // A score import's open items are things like a missing tempo, not notes.
    const unit = entry.source === 'score' ? 'thing' : 'note';
    label = n > 0 ? 'Draft — ' + n + ' ' + unit + (n === 1 ? '' : 's') + ' to check' : 'Draft';
  } else {
    label = 'Checked';
  }
  if (entry.originalAudioKept === false) label += ' — Original recording not kept';
  return label;
}

// Importer warnings (src/song/import-abc.js, import-musicxml.js) are terse
// developer strings; the learner sees these plain-words versions instead.
// Anything unrecognised passes through unchanged, never dropped.
export function plainImportWarning(w) {
  const s = String(w);
  if (/^no (Q: )?tempo found; defaulted to 120 bpm$/.test(s)) return "This file doesn't say how fast to play, so I used 120 beats per minute. Check the speed feels right.";
  let m = /^part "(.*)" has (\d+) voices; flattened into one$/.exec(s);
  if (m) return 'The "' + m[1] + '" part has ' + m[2] + ' voices playing at once; I merged them into one line.';
  m = /^track "(.*)" has (\d+) voices in one bar; flattened into one$/.exec(s);
  if (m) return 'The "' + m[1] + '" track has ' + m[2] + ' voices playing at once; I merged them into one line.';
  m = /^part "(.*)" has (\d+) staves; hands not assigned$/.exec(s);
  if (m) return 'The "' + m[1] + '" part has ' + m[2] + ' staves; I could not tell which notes belong to which hand.';
  return s;
}

// A copy of learn.js's practiceGate rule (learn.js:90-94): a song with any
// open flagged notes cannot be practised until they are resolved. Kept as
// its own copy here, not an import, so src/ui/learn.js stays untouched by
// this unit (tests/unit/learn-source.test.mjs and every learn.js
// characterization test are unaffected).
export function reviewGate(warnings) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return { allowed: true, reason: null };
  return { allowed: false, reason: 'Fix up the ' + list.length + ' thing' + (list.length === 1 ? '' : 's') + ' to check first, then practise.' };
}
