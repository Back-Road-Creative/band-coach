// Triad/seventh construction (stacked thirds, correctly spelled -- C dim7 is
// C Eb Gb Bbb, not C Eb Gb A), diatonic chords of a key, inversions, a reverse
// pitch-class-set lookup, and playable fretboard voicings. Wiring note:
// `chord()`'s `pitchClasses` is what a synth sounds; `notes` (letter +
// accidental) is what notation prints.

import { LETTERS, mod7, mod12, spellAtLetter, toSpelling } from './pitch.js';
import { majorScale } from './scales.js';

// intervals: semitones from the root. letterSteps: letters up from the root
// (stacked thirds = 2 letters/third; sus chords use a 2nd or 4th instead).
const QUALITIES = {
  maj: { intervals: [0, 4, 7], letterSteps: [0, 2, 4] },
  min: { intervals: [0, 3, 7], letterSteps: [0, 2, 4] },
  dim: { intervals: [0, 3, 6], letterSteps: [0, 2, 4] },
  aug: { intervals: [0, 4, 8], letterSteps: [0, 2, 4] },
  sus2: { intervals: [0, 2, 7], letterSteps: [0, 1, 4] },
  sus4: { intervals: [0, 5, 7], letterSteps: [0, 3, 4] },
  '7': { intervals: [0, 4, 7, 10], letterSteps: [0, 2, 4, 6] },
  maj7: { intervals: [0, 4, 7, 11], letterSteps: [0, 2, 4, 6] },
  m7: { intervals: [0, 3, 7, 10], letterSteps: [0, 2, 4, 6] },
  'm7b5': { intervals: [0, 3, 6, 10], letterSteps: [0, 2, 4, 6] },
  dim7: { intervals: [0, 3, 6, 9], letterSteps: [0, 2, 4, 6] },
};

export function chordQualities() {
  return Object.keys(QUALITIES);
}

// rootSpelling: 'C'/'F#'/'Bb' style string, or { letter, accidental }.
// Returns { root, quality, pitchClasses: number[], notes: [{ letter, accidental, pc }] }.
export function chord(rootSpelling, quality) {
  const q = QUALITIES[quality];
  if (!q) throw new Error('unknown chord quality: ' + JSON.stringify(quality));
  const root = toSpelling(rootSpelling);
  const rootLetterIndex = LETTERS.indexOf(root.letter);
  const notes = q.intervals.map((semitones, i) => {
    const pc = mod12(root.pc + semitones);
    return spellAtLetter(pc, mod7(rootLetterIndex + q.letterSteps[i]));
  });
  return {
    root: root.letter + root.accidental,
    quality,
    pitchClasses: notes.map(n => n.pc),
    notes: notes.map(n => ({ letter: n.letter, accidental: n.accidental, pc: n.pc })),
  };
}

const ROMAN_MAJOR = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_DEGREE_QUALITY = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];

// The seven diatonic triads of a major key, each with its roman numeral.
export function diatonicChords(key) {
  const built = majorScale(key);
  return built.degrees.map((degree, i) => {
    const quality = MAJOR_DEGREE_QUALITY[i];
    const numeral = quality === 'maj' ? ROMAN_MAJOR[i] : ROMAN_MAJOR[i].toLowerCase() + (quality === 'dim' ? '°' : '');
    return { degree: i + 1, numeral, ...chord({ letter: degree.letter, accidental: degree.accidental }, quality) };
  });
}

// Rotate a chord's notes so `inversion` (0 = root position, 1 = first...)
// puts that tone at the bottom; pitch classes are untouched, only order.
export function invert(built, inversion) {
  const n = built.notes.length;
  const shift = ((inversion % n) + n) % n;
  const notes = built.notes.slice(shift).concat(built.notes.slice(0, shift));
  return { ...built, inversion: shift, notes };
}

// Reverse lookup: which known quality do these pitch classes spell, trying
// each as root -- a dim7 chord has 4 equally valid roots, so [] or many can return.
export function nameChord(pitchClasses) {
  const set = new Set(pitchClasses.map(mod12));
  const pcs = [...set];
  const results = [];
  for (const rootPc of pcs) {
    for (const [quality, q] of Object.entries(QUALITIES)) {
      const wanted = new Set(q.intervals.map(i => mod12(rootPc + i)));
      if (wanted.size === set.size && [...wanted].every(pc => set.has(pc))) {
        results.push({ rootPc, quality });
      }
    }
  }
  return results;
}

// Playable shapes of `built` on `tuning` (open-string MIDI, low string first):
// each sounding string lands on a chord tone, >=3 strings sound, ranked by
// lowest position/span/string-count so open-position shapes surface early.
export function voicingsOnFretboard(built, tuning, { maxFret = 4, maxSpan = 4 } = {}) {
  const wanted = new Set(built.pitchClasses.map(mod12));
  const perString = tuning.map(openMidi => {
    const options = [null]; // null = muted
    for (let fret = 0; fret <= maxFret; fret++) {
      if (wanted.has(mod12(openMidi + fret))) options.push(fret);
    }
    return options;
  });

  const results = [];
  const combo = new Array(tuning.length).fill(null);
  (function walk(stringIndex) {
    if (stringIndex === tuning.length) {
      const frets = combo.filter(f => f !== null);
      if (frets.length < 3) return;
      const pcsUsed = new Set();
      combo.forEach((f, i) => { if (f !== null) pcsUsed.add(mod12(tuning[i] + f)); });
      if (![...wanted].every(pc => pcsUsed.has(pc))) return; // every chord tone must be present somewhere
      const fretted = frets.filter(f => f > 0);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > maxSpan) return;
      results.push({
        frets: combo.slice(),
        frettedCount: fretted.length,
        stringCount: frets.length,
        span,
        highestFret: frets.length ? Math.max(...frets) : 0,
      });
      return;
    }
    for (const option of perString[stringIndex]) {
      combo[stringIndex] = option;
      walk(stringIndex + 1);
    }
    combo[stringIndex] = null;
  })(0);

  // Simplest first: low position (highest fret used) and small span read as
  // "easy hand shape" before "few strings" -- otherwise a sparse 3-note voicing
  // up the neck would outrank the standard low, full-strung open-position shape.
  results.sort((a, b) =>
    a.highestFret - b.highestFret ||
    a.span - b.span ||
    b.stringCount - a.stringCount ||
    a.frettedCount - b.frettedCount);
  return results.map(({ frets, frettedCount, span, stringCount }) => ({ frets, frettedCount, span, stringCount }));
}
