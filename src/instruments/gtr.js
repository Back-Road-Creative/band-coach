// Extracted from src/app.js: tuning at MODS.gtr.tuning (app.js:77, standard EADGBE
// [40,45,50,55,59,64]) and the 20-level curriculum built by stringLevels(tuning,
// ['Low E','A','D','G','B','High E'], 12, ['Em','G','C','D','Am','E','A']) at
// app.js:106, whose level-naming logic lives at app.js:57-66. Range high (76) is
// the 12th fret on the high E string (64+12); low (40) is the open low E.
// Guitar is heard through a microphone (app.js MODS.gtr.input === 'pluck').
// octavePolicy is exact: the right letter in the wrong octave is a wrong
// note (the mic cannot tell which string was used, so position is taught by
// diagram).
export default {
  id: 'gtr',
  name: 'Guitar',
  family: 'fretted',
  input: 'mic',
  range: { low: 40, high: 76 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [40, 45, 50, 55, 59, 64],
  fretted: true,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['Low E string, frets 1 to 5'] },
    { level: 3, items: ['Low E string, up the neck'] },
    { level: 4, items: ['A string, frets 1 to 5'] },
    { level: 5, items: ['A string, up the neck'] },
    { level: 6, items: ['D string, frets 1 to 5'] },
    { level: 7, items: ['D string, up the neck'] },
    { level: 8, items: ['G string, frets 1 to 5'] },
    { level: 9, items: ['G string, up the neck'] },
    { level: 10, items: ['B string, frets 1 to 5'] },
    { level: 11, items: ['B string, up the neck'] },
    { level: 12, items: ['High E string, frets 1 to 5'] },
    { level: 13, items: ['High E string, up the neck'] },
    { level: 14, items: ['Moves: two notes'] },
    { level: 15, items: ['Moves: three notes'] },
    { level: 16, items: ['Find it by name, no dot'] },
    { level: 17, items: ['Sharps and flats by name'] },
    { level: 18, items: ['First chords (listening is experimental)'] },
    { level: 19, items: ['More chords'] },
    { level: 20, items: ['Chord changes'] }
  ]
};
