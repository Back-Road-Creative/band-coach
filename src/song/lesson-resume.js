// A key that says whether a saved song lesson is still the same lesson, and
// a small bounded list of saved lesson places (one per song+part+instrument,
// newest first). Pure functions only: no DOM, no Date.now, no randomness, no
// AudioContext -- the caller owns everything else (P5's resumable practice
// state). "Never trust saved data" follows src/ui/theory/lesson-state.js:14:
// every sanitize function coerces whatever localStorage handed back into a
// safe shape or drops it, and never throws.

import { arrangementKey } from './arrange/index.js';
import { songTempoEntries } from './clock.js';

export const LESSONS_MAX = 12;
export const TAIL_MAX = 8;

// A fast, simple 32-bit fingerprint (FNV-1a) of a string, as 8 hex digits.
// No crypto needed: this only has to notice that something changed.
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// A revision of the chosen part's musical content: notes, metre and key
// (and any changes to them), plus the song's own ticksPerQuarter. Title,
// id, bpm and tempoMap are left out on purpose -- a rename or a tempo
// change is not a new lesson to relearn from step 1.
export function songRevision(song, partId) {
  const part = (song.parts || []).find((p) => p.id === partId);
  const notes = part ? part.notes.map((n) => [n.start, n.dur, n.midi, n.piece != null ? n.piece : null]) : [];
  const payload = {
    tpq: song.ticksPerQuarter,
    metre: song.metre,
    metreChanges: song.metreChanges || [],
    key: song.key,
    keyChanges: song.keyChanges || [],
    notes
  };
  return fnv1a(JSON.stringify(payload));
}

// The song's own tempo curve (song.bpm merged with tempoMap), as a plain
// string. This is a key field, not the ladder rung's rate -- a learner's
// slowed-down rung speed is saved state and is restored, not keyed, so it
// is never included here. A future learner tempo slider must add its
// value to this string too.
export function tempoKey(song) {
  return songTempoEntries(song).map((e) => e.tick + ':' + e.bpm).join(',');
}

// The seven fields that together say "this is the same lesson": song
// identity + revision, the chosen part, what the arrangement looks like
// (capo/tuning/key shift/harp advice, via arrangementKey), the setup that
// changes what is actually played, the tempo curve, and the assistance
// scope. `setup` deliberately leaves out leftHanded (display only) and
// voiceRange (already folded into arrangement via shiftSemitones); for a
// free-reed instrument it also folds in the harmonica key, because two
// different harp keys can otherwise produce the same arrangementKey.
export function lessonKey({ song, partId, instrumentId, setup, arrangement, assistance }) {
  const capo = setup && Number.isFinite(setup.capo) ? setup.capo : 0;
  const tuning = (setup && setup.tuning) || '';
  const harpKey = arrangement && arrangement.family === 'free-reed' && setup && Number.isInteger(setup.harpKey) ? setup.harpKey : '';
  return {
    songId: song.id,
    rev: songRevision(song, partId),
    partId,
    arrangement: arrangementKey(arrangement),
    setup: [instrumentId, capo, tuning, harpKey].join('|'),
    tempo: tempoKey(song),
    assist: assistance
  };
}

const LESSON_KEY_FIELDS = ['songId', 'rev', 'partId', 'arrangement', 'setup', 'tempo', 'assist'];

// Strict field-by-field equality over the seven lessonKey fields. A field
// missing from either side counts as different, never as a match.
export function sameLessonKey(a, b) {
  if (!a || !b) return false;
  return LESSON_KEY_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(a, f) && Object.prototype.hasOwnProperty.call(b, f) && a[f] === b[f]);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeKey(raw) {
  if (!isPlainObject(raw)) return null;
  const key = {};
  for (const f of LESSON_KEY_FIELDS) {
    if (typeof raw[f] !== 'string' && typeof raw[f] !== 'number') return null;
    key[f] = raw[f];
  }
  return key;
}

function sanitizeTailRow(raw, stepIndex) {
  if (!isPlainObject(raw)) return null;
  if (raw.stepIndex !== stepIndex) return null;
  if (typeof raw.passed !== 'boolean') return null;
  return { stepIndex, passed: raw.passed };
}

// Coerces one raw saved-lesson entry into a safe shape, or null when it
// cannot be trusted (junk, hand-edited, or a lesson that has since
// finished -- stepIndex >= stepCount, when stepCount is given, means the
// lesson is over, so it should start fresh rather than resume nowhere).
export function sanitizeLessonEntry(raw, stepCount) {
  if (!isPlainObject(raw)) return null;
  const key = sanitizeKey(raw.key);
  if (!key) return null;
  if (!Number.isInteger(raw.stepIndex) || raw.stepIndex < 0) return null;
  if (Number.isInteger(stepCount) && raw.stepIndex >= stepCount) return null;
  const stepIndex = raw.stepIndex;
  const tail = Array.isArray(raw.tail)
    ? raw.tail.map((row) => sanitizeTailRow(row, stepIndex)).filter((row) => row !== null).slice(0, TAIL_MAX)
    : [];
  const level = Number.isInteger(raw.level) && raw.level >= 1 && raw.level <= 99 ? raw.level : 1;
  const rate = Number.isFinite(raw.rate) && raw.rate > 0 && raw.rate <= 1 ? raw.rate : null;
  return { key, stepIndex, tail, level, rate };
}

// Sanitizes a whole saved list: drops any junk entry, then caps it at
// LESSONS_MAX, keeping the front of the array (most recent first) --
// mirrors rememberLesson's ordering, never rearranges what survives.
export function sanitizeLessonList(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  for (const entry of raw) {
    const sanitized = sanitizeLessonEntry(entry);
    if (sanitized) clean.push(sanitized);
    if (clean.length >= LESSONS_MAX) break;
  }
  return clean;
}

// Returns a NEW list with `entry` first. Any older entry for the same
// song, part and instrument is dropped first, whatever its other key
// fields are -- one saved place per song+part+instrument, so a stale
// revision never piles up alongside the fresh one. Capped at
// LESSONS_MAX. Never mutates `list`.
export function rememberLesson(list, entry) {
  const sameSlot = (e) => e.key.songId === entry.key.songId && e.key.partId === entry.key.partId && e.key.setup.split('|')[0] === entry.key.setup.split('|')[0];
  const rest = (list || []).filter((e) => !sameSlot(e));
  return [entry, ...rest].slice(0, LESSONS_MAX);
}

// Returns the entry in `list` whose key sameLessonKey-matches `key`, or
// null.
export function findLesson(list, key) {
  return (list || []).find((e) => sameLessonKey(e.key, key)) || null;
}

// The trailing run of `results` on `stepIndex` -- the only slice nextStep
// (lesson.js:561-578) and trailingFailsOnStep (songs.js:1569) actually
// read, capped at TAIL_MAX so a saved lesson never carries the whole
// results history.
export function resultsTail(results, stepIndex) {
  const tail = [];
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].stepIndex !== stepIndex) break;
    tail.unshift(results[i]);
  }
  return tail.slice(-TAIL_MAX);
}
