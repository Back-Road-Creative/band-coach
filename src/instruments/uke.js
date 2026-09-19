// Extracted from src/app.js: tuning at MODS.uke.tuning (app.js:79, high-G re-entrant
// GCEA [67,60,64,69]) and the 16-level curriculum built by stringLevels(tuning,
// ['G','C','E','A'], 7, ['C','Am','F','G7']) at app.js:108 (naming logic app.js:57-66).
// Range: low is the lowest-pitched open string, C (60); high is the 7th fret on the
// high-G string (67+7=74). Tuning is kept in the app's own played order (string 4
// down to string 1: G, C, E, A) rather than sorted low-to-high, because standard
// ukulele tuning is re-entrant -- the G string rings HIGHER than the C string next
// to it (same re-entrant idea as the 5-string banjo's 5th string; see banjo.js).
// octavePolicy is exact: the right letter in the wrong octave is a wrong note (the
// mic cannot tell which string was used, so position is taught by diagram).
export default {
  id: 'uke',
  name: 'Ukulele',
  family: 'fretted',
  input: 'mic',
  range: { low: 60, high: 74 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [67, 60, 64, 69],
  fretted: true,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['G string, frets 1 to 5'] },
    { level: 3, items: ['G string, up the neck'] },
    { level: 4, items: ['C string, frets 1 to 5'] },
    { level: 5, items: ['C string, up the neck'] },
    { level: 6, items: ['E string, frets 1 to 5'] },
    { level: 7, items: ['E string, up the neck'] },
    { level: 8, items: ['A string, frets 1 to 5'] },
    { level: 9, items: ['A string, up the neck'] },
    { level: 10, items: ['Moves: two notes'] },
    { level: 11, items: ['Moves: three notes'] },
    { level: 12, items: ['Find it by name, no dot'] },
    { level: 13, items: ['Sharps and flats by name'] },
    { level: 14, items: ['First chords (listening is experimental)'] },
    { level: 15, items: ['More chords'] },
    { level: 16, items: ['Chord changes'] }
  ]
};
