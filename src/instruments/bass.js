// Extracted from src/app.js: tuning at MODS.bass.tuning (app.js:78, standard EADG
// [28,33,38,43]) and the 13-level curriculum built by stringLevels(tuning,
// ['E','A','D','G'], 12, null) at app.js:107 (no chordSet -> no chord levels; the
// naming logic is app.js:57-66). Range high (55) is the 12th fret on the G string
// (43+12); low (28) is the open E string. Mic input, any-octave name matching, so
// octavePolicy is exact: the right letter in the wrong octave is a wrong note (the
// mic cannot tell which string was used, so position is taught by diagram).
// Bass, like guitar, is a transposing instrument on the page: standard
// notation prints it an octave above its sounding pitch.
export default {
  id: 'bass',
  name: 'Bass',
  family: 'fretted',
  input: 'mic',
  range: { low: 28, high: 55 },
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [28, 33, 38, 43],
  fretted: true,
  writtenOctaveUp: true,
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['E string, frets 1 to 5'] },
    { level: 3, items: ['E string, up the neck'] },
    { level: 4, items: ['A string, frets 1 to 5'] },
    { level: 5, items: ['A string, up the neck'] },
    { level: 6, items: ['D string, frets 1 to 5'] },
    { level: 7, items: ['D string, up the neck'] },
    { level: 8, items: ['G string, frets 1 to 5'] },
    { level: 9, items: ['G string, up the neck'] },
    { level: 10, items: ['Moves: two notes'] },
    { level: 11, items: ['Moves: three notes'] },
    { level: 12, items: ['Find it by name, no dot'] },
    { level: 13, items: ['Sharps and flats by name'] }
  ]
};
