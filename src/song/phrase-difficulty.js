// Phrase difficulty scoring (plan unit E2). Pure module: no DOM, no
// AudioContext, no clock reads -- caller supplies everything, including
// what "one beat" means in ticks (segment()'s own bar/beat math, see
// src/song/lesson.js).
//
// Public API:
//   phraseDifficulty(phrase, opts) -> { score: 0..1, parts: { density,
//     range, leaps, rhythm, accidentals } }
//     phrase: one entry of segment()'s output, { bars, startTick, endTick,
//     notes: [{ start, dur, midi, ... }] } (song/1 note shape, see
//     src/song/model.js). opts: { beatTicks?, key? }. beatTicks is ticks
//     per beat (defaults to one quarter note at TICKS_PER_QUARTER, i.e. a
//     4/4-at-quarter beat); pass the song's real beatTicks (ticksPerQuarter
//     * 4 / metre.den) for a metre-accurate rhythm score. key is the song's
//     { tonic: 0-11, mode: 'major'|'minor' } (song/1 shape) or null/omitted
//     if unknown, in which case accidentals scores 0 for every phrase
//     (never guessed).
//   orderByDifficulty(phrases, opts) -> [{ index, phrase, difficulty }]
//     Stable ascending sort by difficulty.score; `index` is the phrase's
//     position in the INPUT array, carried along so a caller can still map
//     back to the original segment() order after sorting.
//   WEIGHTS: the five part weights phraseDifficulty combines into `score`
//     (sum to 1) -- exported so a caller (or a later unit) can explain or
//     reuse the same combination.

import { TICKS_PER_QUARTER } from './model.js';
import { mod12 } from '../core/theory/pitch.js';
import { keyByTonicMode } from '../core/theory/keys.js';
import { majorScale, naturalMinorScale } from '../core/theory/scales.js';

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// ---------------------------------------------------------------------------
// density: notes per beat. A phrase playing at or above DENSITY_CAP notes
// per beat (four 16th-notes to the beat) is maximally dense.
// ---------------------------------------------------------------------------

const DENSITY_CAP = 4;

function densityScore(phrase, beatTicks) {
  const durationTicks = phrase.endTick - phrase.startTick;
  if (durationTicks <= 0 || phrase.notes.length === 0) return 0;
  const durationBeats = durationTicks / beatTicks;
  const notesPerBeat = phrase.notes.length / durationBeats;
  return clamp01(notesPerBeat / DENSITY_CAP);
}

// ---------------------------------------------------------------------------
// range: semitone span from the phrase's lowest to highest note. A span at
// or above RANGE_CAP (two octaves) is maximally wide.
// ---------------------------------------------------------------------------

const RANGE_CAP = 24;

function rangeScore(phrase) {
  const notes = phrase.notes;
  if (notes.length < 2) return 0;
  let low = Infinity, high = -Infinity;
  for (const n of notes) {
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
  }
  return clamp01((high - low) / RANGE_CAP);
}

// ---------------------------------------------------------------------------
// leaps: share of consecutive-note intervals bigger than LEAP_THRESHOLD
// semitones, each weighted by its own size (an octave leap, LEAP_CAP
// semitones, counts as a full-weight leap; anything bigger is capped at 1).
// Intervals at or below the threshold contribute 0, not a partial amount --
// a leap is a step-function in how a phrase FEELS to play, not a gradient.
// ---------------------------------------------------------------------------

const LEAP_THRESHOLD = 4;
const LEAP_CAP = 12;

function leapsScore(phrase) {
  const notes = phrase.notes;
  if (notes.length < 2) return 0;
  let totalWeight = 0;
  for (let i = 1; i < notes.length; i++) {
    const interval = Math.abs(notes[i].midi - notes[i - 1].midi);
    if (interval > LEAP_THRESHOLD) totalWeight += clamp01(interval / LEAP_CAP);
  }
  return clamp01(totalWeight / (notes.length - 1));
}

// ---------------------------------------------------------------------------
// rhythm: a blend of three sub-signals, each 0..1, combined by
// RHYTHM_WEIGHTS (summing to 1):
//   variety      - distinct note durations used, relative to how many
//                   distinct durations a phrase this size could plausibly
//                   show (capped at VARIETY_CAP so a long phrase doesn't
//                   need an implausible number of distinct values to hit 1).
//   offbeat      - share of notes that do NOT start exactly on a beat.
//   syncopation  - share of notes that start off the beat AND sustain past
//                   the next beat line (the classic "anticipated, held
//                   through the downbeat" syncopation shape).
// ---------------------------------------------------------------------------

const VARIETY_CAP = 4;
const RHYTHM_WEIGHTS = { variety: 0.4, offbeat: 0.3, syncopation: 0.3 };

function rhythmScore(phrase, beatTicks) {
  const notes = phrase.notes;
  if (notes.length === 0) return 0;

  const durationSet = new Set(notes.map(n => n.dur));
  const variety = clamp01(durationSet.size / Math.min(notes.length, VARIETY_CAP));

  let offbeatCount = 0;
  let syncCount = 0;
  for (const n of notes) {
    const posInBeat = ((n.start - phrase.startTick) % beatTicks + beatTicks) % beatTicks;
    if (posInBeat === 0) continue;
    offbeatCount++;
    const distanceToNextBeat = beatTicks - posInBeat;
    if (n.dur > distanceToNextBeat) syncCount++;
  }
  const offbeat = offbeatCount / notes.length;
  const syncopation = syncCount / notes.length;

  return clamp01(
    RHYTHM_WEIGHTS.variety * variety +
    RHYTHM_WEIGHTS.offbeat * offbeat +
    RHYTHM_WEIGHTS.syncopation * syncopation
  );
}

// ---------------------------------------------------------------------------
// accidentals: share of notes whose pitch class is outside the song's key
// (major or natural-minor scale, matching what src/notation/spell.js and
// the key picker already treat as "in the key"). key is a song/1 { tonic,
// mode } pair or null; unknown key scores 0 rather than guessing.
// ---------------------------------------------------------------------------

function accidentalsScore(phrase, key) {
  const notes = phrase.notes;
  if (!key || notes.length === 0) return 0;
  const resolvedKey = keyByTonicMode(key.tonic, key.mode);
  const built = key.mode === 'minor' ? naturalMinorScale(resolvedKey) : majorScale(resolvedKey);
  const inKey = new Set(built.degrees.map(d => d.pc));
  let outside = 0;
  for (const n of notes) {
    if (!inKey.has(mod12(n.midi))) outside++;
  }
  return outside / notes.length;
}

// ---------------------------------------------------------------------------
// combined score
// ---------------------------------------------------------------------------

export const WEIGHTS = { density: 0.2, range: 0.2, leaps: 0.25, rhythm: 0.2, accidentals: 0.15 };

export function phraseDifficulty(phrase, opts = {}) {
  const beatTicks = opts.beatTicks || TICKS_PER_QUARTER;
  const key = opts.key || null;

  const parts = {
    density: densityScore(phrase, beatTicks),
    range: rangeScore(phrase),
    leaps: leapsScore(phrase),
    rhythm: rhythmScore(phrase, beatTicks),
    accidentals: accidentalsScore(phrase, key),
  };

  const score = clamp01(
    WEIGHTS.density * parts.density +
    WEIGHTS.range * parts.range +
    WEIGHTS.leaps * parts.leaps +
    WEIGHTS.rhythm * parts.rhythm +
    WEIGHTS.accidentals * parts.accidentals
  );

  return { score, parts };
}

// Stable ascending sort by difficulty.score; each returned entry keeps the
// phrase's index in the INPUT array (and the phrase itself) so a caller can
// still recover segment()'s original order after sorting. Explicit
// index-tiebreak rather than relying on Array#sort's own stability, so the
// order is guaranteed by this module's contract, not by engine behaviour.
export function orderByDifficulty(phrases, opts = {}) {
  return phrases
    .map((phrase, index) => ({ index, phrase, difficulty: phraseDifficulty(phrase, opts) }))
    .sort((a, b) => a.difficulty.score - b.difficulty.score || a.index - b.index);
}
