// Pitch spelling: pick the correct letter + accidental for a MIDI note number
// given a key signature, instead of always defaulting to sharps or flats.

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const MAJOR_SHARPS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const MAJOR_FLATS = { C: 0, F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7 };

// Minor tonic -> its relative major, covering the same 15 signatures.
const MINOR_TO_MAJOR = {
  Am: 'C', Em: 'G', Bm: 'D', 'F#m': 'A', 'C#m': 'E', 'G#m': 'B', 'D#m': 'F#', 'A#m': 'C#',
  Dm: 'F', Gm: 'Bb', Cm: 'Eb', Fm: 'Ab', Bbm: 'Db', Ebm: 'Gb', Abm: 'Cb',
};

const LETTER_BASE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SHARP_TABLE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TABLE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function resolveToMajor(key) {
  if (Object.prototype.hasOwnProperty.call(MINOR_TO_MAJOR, key)) return MINOR_TO_MAJOR[key];
  return key;
}

// Ordered list of {letter, accidental} altered by the key signature, in the
// order they are added to the staff (F,C,G,D,A,E,B for sharps; B,E,A,D,G,C,F
// for flats). Minor keys resolve to their relative major first.
export function keyAccidentals(key) {
  const major = resolveToMajor(key);
  if (Object.prototype.hasOwnProperty.call(MAJOR_SHARPS, major) && MAJOR_SHARPS[major] > 0) {
    const n = MAJOR_SHARPS[major];
    return SHARP_ORDER.slice(0, n).map((letter) => ({ letter, accidental: '#' }));
  }
  if (Object.prototype.hasOwnProperty.call(MAJOR_FLATS, major) && MAJOR_FLATS[major] > 0) {
    const n = MAJOR_FLATS[major];
    return FLAT_ORDER.slice(0, n).map((letter) => ({ letter, accidental: 'b' }));
  }
  return [];
}

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// spellMidi(midi, key) -> { letter, accidental, octave }
// Scale tones (the 7 pitch classes belonging to the key) are spelled per the
// key signature. Chromatic tones outside the scale fall back to a generic
// sharp or flat spelling depending on whether the key uses sharps or flats.
export function spellMidi(midi, key) {
  const major = resolveToMajor(key);
  const pc = mod12(midi);
  const octave = Math.floor(midi / 12) - 1;
  const altered = keyAccidentals(major);
  const alteredMap = {};
  for (const a of altered) alteredMap[a.letter] = a.accidental;
  const accVal = { '#': 1, b: -1, '': 0 };

  for (const letter of Object.keys(LETTER_BASE_PC)) {
    const acc = alteredMap[letter] || '';
    const eff = mod12(LETTER_BASE_PC[letter] + accVal[acc]);
    if (eff === pc) return { letter, accidental: acc, octave };
  }

  const usesFlats = Object.prototype.hasOwnProperty.call(MAJOR_FLATS, major) && MAJOR_FLATS[major] > 0;
  const table = usesFlats ? FLAT_TABLE : SHARP_TABLE;
  const spelled = table[pc];
  const letter = spelled[0];
  const accidental = spelled.length > 1 ? spelled[1] : '';
  return { letter, accidental, octave };
}
