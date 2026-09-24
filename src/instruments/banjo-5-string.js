// Wired into MODS['banjo-5-string'] in src/app.js: tuning, name and mic
// range all read from THIS record (rangeForInstrument(byId['banjo-5-string']))
// rather than being restated. Standard open-G tuning: [67,50,55,59,62].
// Modeled in PLAYED order, 5th string to 1st (5,4,3,2,1) -- not sorted
// low-to-high -- because the 5th string is re-entrant: it rings at G4 (67),
// higher than the three strings next to it (D3=50, G3=55, B3=59), and only
// the 1st string (D4=62) is above it. This mirrors the same re-entrant idea
// as the ukulele's high-G string (see uke.js). Range covers the full tuning
// plus 12 frets on the main (non-5th) strings, same maxFret as gtr.js/
// bass.js -- a conservative beginner range. The lowest note in play, D3
// (146.8 Hz), is well inside the pitch detector's working band, so every
// level below is mic-tested and real. The 15-level curriculum mirrors
// stringLevels(tuning, ['G','D','G','B','D'], 12, null) at the app.js
// MODS['banjo-5-string'].levels assignment (two levels are legitimately
// both named "G string...": the 5th and 3rd strings are both tuned to G, an
// octave apart, which is standard open-G banjo tuning, not a labeling bug)
// -- no chordSet: the app's chord vocabulary is voiced for guitar/ukulele
// open shapes, not 5-string banjo shapes, so this passes null.
export default {
  id: 'banjo-5-string',
  name: '5-string banjo',
  family: 'fretted',
  input: 'mic',
  range: { low: 50, high: 74 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [67, 50, 55, 59, 62],
  fretted: true,
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['G string, frets 1 to 5'] },
    { level: 3, items: ['G string, up the neck'] },
    { level: 4, items: ['D string, frets 1 to 5'] },
    { level: 5, items: ['D string, up the neck'] },
    { level: 6, items: ['G string, frets 1 to 5'] },
    { level: 7, items: ['G string, up the neck'] },
    { level: 8, items: ['B string, frets 1 to 5'] },
    { level: 9, items: ['B string, up the neck'] },
    { level: 10, items: ['D string, frets 1 to 5'] },
    { level: 11, items: ['D string, up the neck'] },
    { level: 12, items: ['Moves: two notes'] },
    { level: 13, items: ['Moves: three notes'] },
    { level: 14, items: ['Find it by name, no dot'] },
    { level: 15, items: ['Sharps and flats by name'] }
  ]
};
