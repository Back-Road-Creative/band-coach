// Staff geometry: where a spelled note sits on a given clef, which ledger
// lines it needs, and whether it needs a printed accidental.

import { keyAccidentals } from './spell.js';

const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// The note sitting on each clef's bottom line.
const CLEF_BOTTOM_LINE = {
  treble: { letter: 'E', octave: 4 },
  bass: { letter: 'G', octave: 2 },
  alto: { letter: 'F', octave: 3 },
  tenor: { letter: 'D', octave: 3 },
};

function diatonicStep({ letter, octave }) {
  return octave * 7 + LETTER_INDEX[letter];
}

// Integer steps (half a line-space each) from the clef's bottom line.
// 0 = bottom line, 8 = top line, negative = below the staff.
export function staffPosition(note, clef) {
  // Percussion notes aren't real pitches: a percussion "note" is a drum-key
  // slot (src/notation/percussion.js's PERCUSSION_SLOTS) that already carries
  // its own staff position, so there's no letter/octave to look up.
  if (clef === 'percussion') return note.position;
  const ref = CLEF_BOTTOM_LINE[clef];
  if (!ref) throw new Error(`unknown clef: ${clef}`);
  return diatonicStep(note) - diatonicStep(ref);
}

// Ledger-line positions (even integers) needed for a note at `position`.
export function ledgerLines(position) {
  if (position < 0) {
    const n = Math.floor(-position / 2);
    return Array.from({ length: n }, (_, i) => -2 - 2 * i);
  }
  if (position > 8) {
    const n = Math.floor((position - 8) / 2);
    return Array.from({ length: n }, (_, i) => 10 + 2 * i);
  }
  return [];
}

// Courtesy-accidental rule: show an accidental when the note's spelling
// differs from the key signature's default for that letter, remember it for
// the rest of the bar (per letter+octave), and show a natural to cancel a
// previously-shown accidental once the note returns to the key's default.
// `barState` is a plain object the caller resets at the start of each bar.
export function needsAccidental(note, key, barState) {
  const altered = keyAccidentals(key);
  const alteredMap = {};
  for (const a of altered) alteredMap[a.letter] = a.accidental;
  const defaultAccidental = alteredMap[note.letter] || '';
  const pitchKey = `${note.letter}${note.octave}`;
  const previous = Object.prototype.hasOwnProperty.call(barState, pitchKey) ? barState[pitchKey] : undefined;

  if (note.accidental !== defaultAccidental) {
    if (previous === note.accidental) return false;
    barState[pitchKey] = note.accidental;
    return true;
  }

  if (previous !== undefined && previous !== defaultAccidental) {
    barState[pitchKey] = defaultAccidental;
    return true;
  }
  return false;
}
