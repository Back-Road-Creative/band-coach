// Plain-language chord naming for the Explore tab. The core chord() keys
// (maj, min, m7b5...) are internal; a learner expects C7, Bb, Cm.

// Roots as players spell them (flats for the five black keys except F#).
export const EXPLORE_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

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
