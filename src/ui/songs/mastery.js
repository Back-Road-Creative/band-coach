// Maps a MIDI note, played on a given instrument, to the SAME per-item id
// the app's built-in drills use for that instrument's mastery store
// (src/app.js `it(id)` / `S.item[id]`; id formats read from `info()` /
// `validId()` at src/app.js:282-295, and the existing "capture a melody"
// mapper `customItem()` at src/app.js:316-324, which this mirrors exactly
// so a song credits the identical mastery keys a built-in drill would).
// Pure: no DOM, no clock reads, no randomness. `prefs` is the learner's
// saved preference object (DB.prefs, read via api.db().prefs) for the two
// instruments whose item id depends on a runtime choice (voice range,
// wind transposition).
//
// Only instruments the app already has a per-item mastery scheme for are
// mapped: kbd, gtr, bass, uke, voice, wind, harp (the seven
// status:'ready' records in src/instruments/*.js). Every other instrument
// id (the planned ones, with no curriculum wired to S.item) returns null —
// there is nothing to credit yet, and the wiring pass should say so rather
// than invent a key.

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
    case 'kbd':
      return 'n' + fold(midi, 48, 72);
    case 'gtr':
    case 'bass':
    case 'uke':
      return 'p' + pc(midi);
    case 'voice': {
      const base = VOICE_TONIC[prefs.voice] ?? VOICE_TONIC.low;
      return 'v' + (((midi - base) % 12) + 12) % 12;
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
    default:
      return null;
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
