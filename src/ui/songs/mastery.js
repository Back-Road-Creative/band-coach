// Maps a MIDI note, played on a given instrument, to the SAME per-item id
// the app's built-in drills use for that instrument's mastery store
// (src/app.js `it(id)` / `S.item[id]`; id formats read from `info()` /
// `validId()` at src/app.js:282-295). `src/app.js`'s "capture a melody"
// mapper `customItem()` delegates to this function so the two can never
// drift apart again (tests/unit/w-songs-mastery.test.mjs asserts the
// agreement directly).
// Pure: no DOM, no clock reads, no randomness. `prefs` is the learner's
// saved preference object (DB.prefs, read via api.db().prefs) for the two
// instruments whose item id depends on a runtime choice (voice range,
// wind transposition).
//
// voice, wind and harp each need bespoke logic (a runtime-chosen tonic/
// transposition, or a hole-search order) and are switch-cased explicitly
// below. Every other instrument's scheme is DERIVED from its
// src/instruments/*.js registry record rather than hand-typed by id, so a
// newly `status: 'ready'` record is mapped by construction:
//   - `fretted: true` records (gtr, bass, uke, mandolin, banjo-5-string,
//     bass-5-string, ukulele-baritone, ukulele-low-g — every fretted ready
//     record as of this writing) credit by pitch class, any octave: 'p'+pc.
//   - `family: 'keys'` or `family: 'percussion'` records (kbd,
//     mallet-percussion) credit by exact note folded into the record's own
//     `range`: 'n'+fold(midi, range.low, range.high).
// A `status: 'ready'` record that fits neither shape returns null and
// tests/unit/w-songs-mastery.test.mjs's "every ready record maps" check
// will fail CI, rather than the gap shipping silently — see that test
// before adding a new instrument family here.
// Planned instruments (no curriculum wired to S.item) return null: there
// is nothing to credit yet.

import { byId as instrumentById } from '../../instruments/index.js';

// Registry `family` values whose ready records use the same keyboard-style
// scheme MODS.kbd pioneered: a fixed, non-transposing note layout folded
// into the instrument's own beginner range. Currently kbd (family 'keys')
// and mallet-percussion (family 'percussion') — both mic/MIDI instruments
// read as one fixed row of notes, unlike the fretted instruments (any
// string/fret can produce the same pitch class) or voice/wind (a runtime-
// chosen tonic/transposition).
const NOTE_FAMILIES = new Set(['keys', 'percussion']);

function pc(m) {
  return ((Math.round(m) % 12) + 12) % 12;
}

function fold(x, lo, hi) {
  let v = x;
  while (v < lo) v += 12;
  while (v > hi) v -= 12;
  return v;
}

// Hand-checked against src/app.js VOICE_KINDS (app.js:277): low Do = C3
// (48), mid Do = G3 (55), high Do = C4 (60).
const VOICE_TONIC = { low: 48, mid: 55, high: 60 };

// Hand-checked against src/app.js WIND_KINDS (app.js:276): semitone offset
// from written pitch to concert (sounding) pitch for each transposing
// choice, and which of them are read in the bass clef.
const WIND_OFFSET = { c: 0, bb: -2, bbt: -14, eb: -9, ebb: -21, f: -7, bc: -19 };
const WIND_BASS_CLEF = new Set(['bc']);

// Hand-checked against src/instruments/harp.js (range 60-96, tonic C4=60)
// and independently against src/song/lesson.js's RICHTER_*_INTERVALS,
// which derive the same two arrays from a different starting point (the
// major-triad/dominant-seventh arpeggio pattern rather than a typed table):
// blow holes 1-10 -> 60,64,67,72,76,79,84,88,91,96;
// draw holes 1-10 -> 62,67,71,74,77,81,83,86,89,93.
const HARP_BLOW = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96];
const HARP_DRAW = [62, 67, 71, 74, 77, 81, 83, 86, 89, 93];
// Same hole-search order as src/app.js customItem(): middle holes first.
const HARP_HOLE_ORDER = [4, 5, 6, 7, 3, 2, 1, 8, 9, 10];

// Returns the mastery item id S.item is keyed by for `instrumentId`, for a
// note at `midi`, or null when this instrument has no per-item mastery
// scheme (yet) to credit.
export function itemIdForMidi(instrumentId, midi, prefs = {}) {
  switch (instrumentId) {
    // Recorder and tin whistle drill plain N() note ids at sounding pitch
    // (src/app.js MODS entries), folded into the record's own range.
    case 'recorder-descant':
    case 'tin-whistle': {
      const rec = instrumentById[instrumentId];
      return 'n' + fold(midi, rec.range.low, rec.range.high);
    }
    case 'voice': {
      const base = VOICE_TONIC[prefs.voice] ?? VOICE_TONIC.low;
      return 'v' + (((midi - base) % 12) + 12) % 12;
    }
    // Each of these three brass instruments has its own fixed transposition
    // (src/instruments/trumpet-bb.js / horn-f.js / trombone.js) and its own
    // MODS entry with a fixed windKind (src/app.js), unlike 'wind' below
    // whose transposition comes from a runtime preference -- so credit here
    // never reads prefs.wind, and folds into the record's own written range
    // (its curriculum's Wn(...) id space) rather than the shared 60-79
    // MODS.wind range.
    case 'trumpet-bb': {
      const written = midi + 2; // sounding = written - 2
      return 'w' + fold(written, 60, 72);
    }
    case 'horn-f': {
      const written = midi + 7; // sounding = written - 7
      return 'w' + fold(written, 55, 67);
    }
    case 'trombone': {
      // Non-transposing (written = sounding); the 'w' id space stores
      // written + 19, the same bass-clef register shift WIND_KINDS.bc uses
      // in src/app.js's info() 'w' branch, so this must match that.
      return 'w' + fold(midi + 19, 59, 71);
    }
    case 'wind': {
      const off = WIND_OFFSET[prefs.wind] ?? WIND_OFFSET.bb;
      const written = WIND_BASS_CLEF.has(prefs.wind) ? midi + 19 : midi - off;
      return 'w' + fold(written, 60, 79);
    }
    case 'harp': {
      for (const hole of HARP_HOLE_ORDER) {
        if (pc(HARP_BLOW[hole - 1]) === pc(midi)) return 'hb' + hole;
        if (pc(HARP_DRAW[hole - 1]) === pc(midi)) return 'hd' + hole;
      }
      return null;
    }
    default: {
      const rec = instrumentById[instrumentId];
      if (!rec || rec.status !== 'ready') return null;
      // Any record with a tuning (fretted OR bowed) drills pitch classes
      // through stringLevels' 'p' ids, so both credit the same way.
      if (Array.isArray(rec.tuning) && rec.tuning.length) return 'p' + pc(midi);
      if (NOTE_FAMILIES.has(rec.family)) return 'n' + fold(midi, rec.range.low, rec.range.high);
      return null;
    }
  }
}

// `creditFor()` (src/song/lesson.js) returns masteryKeys shaped
// { key: 'midi:<n>', hit }. Maps that array to
// [{ id, hit }] using itemIdForMidi, dropping any key this instrument
// cannot map (see above) — the wiring pass credits only the ones with an id.
export function mapMasteryKeys(masteryKeys, instrumentId, prefs = {}) {
  const out = [];
  for (const { key, hit } of masteryKeys || []) {
    const m = /^midi:(-?\d+)$/.exec(key);
    if (!m) continue;
    const id = itemIdForMidi(instrumentId, Number(m[1]), prefs);
    if (id) out.push({ id, hit });
  }
  return out;
}
