// Plain-language chord naming for the Explore tab. The core chord() keys
// (maj, min, m7b5...) are internal; a learner expects C7, Bb, Cm.

import { keyAccidentals } from '../../notation/spell.js';

// Roots as players spell them: flats for most black keys, but C# and G# stay (C#m, G#m are common).
// D# and A# are left out on purpose (A# major would spell C##).
export const EXPLORE_ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'Ab', 'A', 'Bb', 'B'];

// Key signature to draw a diatonic scale under, or null when the staff has no signature for it
// (Db minor, G# major...): the caller then draws it in C with the scale's own spelling.
export function scaleKeyName(tonicName, type) {
  if (type !== 'major' && type !== 'natural_minor') return null;
  const name = tonicName + (type === 'natural_minor' ? 'm' : '');
  return name === 'C' || name === 'Am' || keyAccidentals(name).length ? name : null;
}

const QUALITY_INFO = {
  maj: { suffix: '', words: 'major' },
  min: { suffix: 'm', words: 'minor' },
  dim: { suffix: 'dim', words: 'diminished' },
  aug: { suffix: 'aug', words: 'augmented' },
  sus2: { suffix: 'sus2', words: 'suspended 2nd' },
  sus4: { suffix: 'sus4', words: 'suspended 4th' },
  '7': { suffix: '7', words: 'dominant 7th' },
  maj7: { suffix: 'maj7', words: 'major 7th' },
  m7: { suffix: 'm7', words: 'minor 7th' },
  m7b5: { suffix: 'm7b5', words: 'half-diminished 7th' },
  dim7: { suffix: 'dim7', words: 'diminished 7th' },
};

export function chordSymbol(root, quality) {
  return root + QUALITY_INFO[quality].suffix;
}

export function qualityWords(quality) {
  return QUALITY_INFO[quality].words;
}
