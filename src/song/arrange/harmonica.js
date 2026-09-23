// Harmonica key-fitting: which of the 12 harmonica keys (0-11, 0 = C,
// matching schema.js's `key.tonic` convention) plays a given melody best,
// and how (which hole/action/bend) once a key is chosen.
//
// Unwired (Wave D5): this module only computes candidates. src/song/lesson.js
// still fits a song to a SINGLE already-picked harmonica record; a future
// wiring pass (D8) is expected to let a learner ask "which harmonica of the
// 12 should I buy/pick up for this song" and use fitHarmonicaKey/
// bestHarmonicaKey to answer that, then arrangeHarmonica to render the
// fingerings. Pure module: no DOM, no AudioContext, no randomness, no clock
// reads; caller owns everything ambiguous.

import { holesFor } from '../../instruments/how/harmonica.js';

// Octave shifts to try per key: a song can be moved up/down whole octaves
// to land inside a given harp's fixed 3-octave range, but never by a plain
// semitone shift (that would just be a different key of harmonica, which is
// exactly the "keys" dimension we are already searching).
const DEFAULT_SHIFTS = [0, -12, 12, -24, 24];
const DEFAULT_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Preference order for tie-breaking equally-good keys: the harmonicas a
// beginner is actually likely to own or be able to buy locally (C, G, A, D,
// F, in roughly that popularity order for folk/blues playing) beat the
// remaining, rarer keys, which fall back to plain numeric (key) order.
const KEY_PREFERENCE = [0, 7, 9, 2, 5];

function keyPreferenceRank(key) {
  const i = KEY_PREFERENCE.indexOf(key);
  return i === -1 ? KEY_PREFERENCE.length : i;
}

// Every way `midi` can be sounded on this harmonica: null if none at all,
// otherwise { bend: boolean } for whether the easiest option requires a bend.
function playability(midi, key) {
  const options = holesFor(midi, key);
  if (options.length === 0) return null;
  const hasOpen = options.some(o => o.semitonesBent === 0);
  return { bend: !hasOpen };
}

// For one (key, shift) pair: which of `notes` play, and at what bend cost.
function evaluate(notes, key, shift, allowBends) {
  const unplayable = [];
  let bendsNeeded = 0;
  for (const note of notes) {
    const shiftedMidi = note.midi + shift;
    const p = playability(shiftedMidi, key);
    if (p === null) {
      unplayable.push(shiftedMidi);
      continue;
    }
    if (p.bend) {
      if (!allowBends) {
        unplayable.push(shiftedMidi);
        continue;
      }
      bendsNeeded++;
    }
  }
  return { key, shift, playable: unplayable.length === 0, unplayable, bendsNeeded };
}

// Ranks two evaluate() results: fewer unplayable notes first, then fewer
// bends, then the smallest shift (friendliest change to the song), then key
// preference order (see KEY_PREFERENCE), then plain numeric key.
function compareEntries(a, b) {
  if (a.unplayable.length !== b.unplayable.length) return a.unplayable.length - b.unplayable.length;
  if (a.bendsNeeded !== b.bendsNeeded) return a.bendsNeeded - b.bendsNeeded;
  const shiftDelta = Math.abs(a.shift) - Math.abs(b.shift);
  if (shiftDelta !== 0) return shiftDelta;
  const prefDelta = keyPreferenceRank(a.key) - keyPreferenceRank(b.key);
  if (prefDelta !== 0) return prefDelta;
  return a.key - b.key;
}

// fitHarmonicaKey(notes, opts) -> one ranked entry PER requested key: the
// best-fitting shift for that key, ranked best-first across all requested
// keys by compareEntries. `notes` is any array of objects with a `.midi`
// (e.g. a Song part's notes); only `.midi` is read.
export function fitHarmonicaKey(notes, opts = {}) {
  const allowBends = opts.allowBends === true;
  const keys = Array.isArray(opts.keys) ? opts.keys : DEFAULT_KEYS;
  const shifts = Array.isArray(opts.shifts) ? opts.shifts : DEFAULT_SHIFTS;

  const entries = keys.map(key => {
    let best = null;
    for (const shift of shifts) {
      const candidate = evaluate(notes, key, shift, allowBends);
      if (best === null || compareEntries(candidate, best) < 0) best = candidate;
    }
    return best;
  });

  return entries.sort(compareEntries);
}

// The single best key (and shift) for this melody -- fitHarmonicaKey's top
// ranked entry.
export function bestHarmonicaKey(notes, opts = {}) {
  return fitHarmonicaKey(notes, opts)[0];
}

// Renders `notes` (already shifted into the chosen key's range by the
// caller -- see bestHarmonicaKey's `shift`) as harmonica fingerings:
// { ...note, hole, action: 'blow'|'draw'|'bend', bendSteps }. `action` is
// 'bend' whenever the easiest option for that pitch requires bending (the
// underlying reed action -- blow or draw -- is not distinguished in the
// name, since a learner cares which hole and how far to bend, not the reed
// direction); bendSteps is 0 for an open blow/draw note. Throws a plain
// Error naming the unplayable pitch rather than silently dropping it --
// this function assumes the caller already picked a key where every note
// fits (e.g. via bestHarmonicaKey), and a note that still does not fit is a
// caller bug, not a fact to hide.
export function arrangeHarmonica(notes, key) {
  return notes.map(note => {
    const options = holesFor(note.midi, key);
    if (options.length === 0) {
      throw new Error('harmonica: note ' + note.midi + ' is not playable in key ' + key);
    }
    const best = options[0]; // holesFor ranks easiest (open) first
    const action = best.semitonesBent > 0 ? 'bend' : best.action;
    return { ...note, hole: best.hole, action, bendSteps: best.semitonesBent };
  });
}
