// Fretboard "how to produce this note" — positions computed for any tuning,
// capo, or named alternate tuning, plus a left-handed display flag. Zero
// dependencies; pure functions; no DOM.
//
// Wiring pass: call `positionsFor(midi, tuning, opts)` where `tuning` is a
// low-to-high array of open-string MIDI pitches (e.g. gtr.js's [40,45,50,
// 55,59,64]) or one of the named tunings below. Returns positions ranked
// lowest-fret first: `{ stringIndex, displayIndex, fret }`. `stringIndex`
// always counts from the lowest-pitched string (0); `displayIndex` is the
// same unless `opts.leftHanded` is set, in which case it is mirrored
// (string order reversed) for drawing — the pitches and frets themselves
// never change for a left-handed player, only which side of the diagram
// each string is drawn on.
//
// --- Capo ---
// A capo shifts every open string up by its fret number and becomes the new
// "nut": playable frets are counted from the capo, not the physical head of
// the instrument, and a player cannot fret behind the capo (fret 0 is the
// capo position itself).
export function positionsFor(midi, tuning, opts = {}) {
  const { capo = 0, maxFret = 12, leftHanded = false } = opts;
  const n = tuning.length;
  const positions = [];
  for (let stringIndex = 0; stringIndex < n; stringIndex++) {
    const openPitch = tuning[stringIndex] + capo;
    const fret = midi - openPitch;
    if (fret >= 0 && fret <= maxFret) {
      const displayIndex = leftHanded ? n - 1 - stringIndex : stringIndex;
      positions.push({ stringIndex, displayIndex, fret });
    }
  }
  positions.sort((a, b) => a.fret - b.fret || a.stringIndex - b.stringIndex);
  return positions;
}

// Named alternate tunings, each derived from a standard reference tuning by
// an explicit, documented rule — not typed independently per string.
//
// Standard 6-string guitar (EADGBE), the same pitches as src/instruments/
// gtr.js's tuning: E2 A2 D3 G3 B3 E4.
export const STANDARD_GUITAR = [40, 45, 50, 55, 59, 64];

// Drop D: only the lowest string drops a whole tone (E2 -> D2).
export const DROP_D = [STANDARD_GUITAR[0] - 2, ...STANDARD_GUITAR.slice(1)];

// DADGAD: strings 1 (high E), 2 (B) and 6 (low E) each drop a whole tone;
// strings 3, 4 and 5 (D, G, A) are already standard pitches.
export const DADGAD = STANDARD_GUITAR.map((p, i) => (i === 0 || i === 4 || i === 5 ? p - 2 : p));

// Open G: strings 1 (high E), 2 (A) and 6 (low E) each drop a whole tone;
// strings 3, 4 and 5 (D, G, B) are already the open-chord tones.
export const OPEN_G = STANDARD_GUITAR.map((p, i) => (i === 0 || i === 1 || i === 5 ? p - 2 : p));

// Open D: D A D F# A D — the standard open-D chord tuning.
export const OPEN_D = [38, 45, 50, 54, 57, 62];

// Half-step down: every string drops one semitone.
export const HALF_STEP_DOWN = STANDARD_GUITAR.map(p => p - 1);

// Low-G ukulele: same pitches as src/instruments/ukulele-low-g.js.
export const UKULELE_LOW_G = [55, 60, 64, 69];

// High-G (re-entrant, standard) ukulele: same pitches as src/instruments/
// uke.js, kept in its played string order (G above C, not sorted low-high).
export const UKULELE_HIGH_G = [67, 60, 64, 69];

// 5-string bass: same pitches as src/instruments/bass-5-string.js.
export const BASS_5_STRING = [23, 28, 33, 38, 43];

export const TUNINGS = {
  standard: STANDARD_GUITAR,
  'drop-d': DROP_D,
  dadgad: DADGAD,
  'open-g': OPEN_G,
  'open-d': OPEN_D,
  'half-step-down': HALF_STEP_DOWN,
  'ukulele-low-g': UKULELE_LOW_G,
  'ukulele-high-g': UKULELE_HIGH_G,
  'bass-5-string': BASS_5_STRING
};

export function tuningFor(name) {
  const t = TUNINGS[name];
  if (!t) throw new Error('unknown tuning ' + JSON.stringify(name));
  return t;
}
