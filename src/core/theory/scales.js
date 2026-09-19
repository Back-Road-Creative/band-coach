// Scale construction from interval patterns, spelled so a heptatonic (7-note)
// scale uses every letter exactly once -- F# major's 7th degree is E#, not F.
// Wiring note: `scale()` returns pitch classes + degrees, not octaves; call
// `scaleOnInstrument` to place it on a real range.

import { LETTERS, mod12, mod7, spellAtLetter, nearestSpelling, toSpelling } from './pitch.js';

// Semitone steps between consecutive scale degrees (wrapping back to the tonic).
export const PATTERNS = {
  major: [2, 2, 1, 2, 2, 2, 1],
  natural_minor: [2, 1, 2, 2, 1, 2, 2],
  harmonic_minor: [2, 1, 2, 2, 1, 3, 1],
  melodic_minor: [2, 1, 2, 2, 2, 2, 1],
  dorian: [2, 1, 2, 2, 2, 1, 2],
  phrygian: [1, 2, 2, 2, 1, 2, 2],
  lydian: [2, 2, 2, 1, 2, 2, 1],
  mixolydian: [2, 2, 1, 2, 2, 1, 2],
  locrian: [1, 2, 2, 1, 2, 2, 2],
  major_pentatonic: [2, 2, 3, 2, 3],
  minor_pentatonic: [3, 2, 2, 3, 2],
  blues: [3, 2, 1, 1, 3, 2],
};

export function scaleTypes() {
  return Object.keys(PATTERNS);
}

// tonicSpelling: a 'F#'/'Bb'/'C' style string, or { letter, accidental }.
// Returns { type, tonicPc, degrees: [{ degree, pc, letter, accidental }] }.
export function scale(tonicSpelling, type) {
  const pattern = PATTERNS[type];
  if (!pattern) throw new Error('unknown scale type: ' + JSON.stringify(type));
  const tonic = toSpelling(tonicSpelling);
  const tonicLetterIndex = LETTERS.indexOf(tonic.letter);
  if (tonicLetterIndex < 0) throw new Error('bad tonic letter: ' + JSON.stringify(tonicSpelling));

  const heptatonic = pattern.length === 7;
  const degrees = [];
  let pc = mod12(tonic.pc);
  let letterIndex = tonicLetterIndex;
  for (let i = 0; i < pattern.length; i++) {
    const spelled = heptatonic
      ? spellAtLetter(pc, letterIndex)
      : nearestSpelling(pc, letterIndex);
    degrees.push({ degree: i + 1, pc, letter: spelled.letter, accidental: spelled.accidental });
    pc = mod12(pc + pattern[i]);
    letterIndex = mod7(letterIndex + 1);
  }
  return { type, tonicPc: mod12(tonic.pc), degrees };
}

// Convenience wrappers for the two scales src/notation/spell.js already knows
// how to spell via a key signature -- built from the same key object so the
// two never disagree about which letters are altered.
export function majorScale(key) {
  return scale({ letter: key.letter, accidental: key.accidental }, 'major');
}

export function naturalMinorScale(key) {
  return scale({ letter: key.letter, accidental: key.accidental }, 'natural_minor');
}

function degreeFor(built, pc) {
  return built.degrees.find(d => d.pc === mod12(pc));
}

// Playable notes of a scale on one instrument record (src/instruments/*.js):
// fret/string positions for a `tuning` array, else plain MIDI across its range
// (covers `harp` today too -- no per-hole layout exists yet to attach).
export function scaleOnInstrument(built, instrument, { maxFret = 15 } = {}) {
  const { low, high } = instrument.range;
  if (Array.isArray(instrument.tuning) && instrument.tuning.length) {
    const notes = [];
    instrument.tuning.forEach((openMidi, stringIndex) => {
      for (let fret = 0; fret <= maxFret; fret++) {
        const midi = openMidi + fret;
        if (midi < low || midi > high) continue;
        const degree = degreeFor(built, midi);
        if (!degree) continue;
        notes.push({ string: stringIndex, fret, midi, degree: degree.degree, letter: degree.letter, accidental: degree.accidental });
      }
    });
    notes.sort((a, b) => a.midi - b.midi || a.string - b.string);
    return notes;
  }
  const notes = [];
  for (let midi = low; midi <= high; midi++) {
    const degree = degreeFor(built, midi);
    if (!degree) continue;
    notes.push({ midi, degree: degree.degree, letter: degree.letter, accidental: degree.accidental });
  }
  return notes;
}
