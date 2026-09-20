// Wired into MODS.mandolin in src/app.js: tuning, name and mic range all
// read from THIS record (rangeForInstrument(byId.mandolin), src/audio/
// range.js) rather than being restated. Standard tuning, fifths G3 D4 A4 E5
// = [55,62,69,76] (courses in unison pairs, modeled here as one pitch per
// course like the app's guitar/bass/uke records). Range extends the open
// strings by 12 frets, same formula/maxFret as gtr.js/bass.js -- a
// conservative beginner range, not the instrument's full compass. The
// lowest open string (G3, 196 Hz) and every fretted note above it are well
// inside the pitch detector's working band (see bass-5-string.js's header
// for where that band actually breaks down), so every level below is
// mic-tested and real. The 13-level curriculum mirrors stringLevels(tuning,
// ['G','D','A','E'], 12, null) at the app.js MODS.mandolin.levels
// assignment -- no chordSet: the app's chord vocabulary (CHORDS in app.js)
// is voiced for guitar/ukulele open shapes, not mandolin fifths-tuning
// shapes, so this passes null rather than inventing one.
export default {
  id: 'mandolin',
  name: 'Mandolin',
  family: 'fretted',
  input: 'mic',
  range: { low: 55, high: 88 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [55, 62, 69, 76],
  fretted: true,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['G string, frets 1 to 5'] },
    { level: 3, items: ['G string, up the neck'] },
    { level: 4, items: ['D string, frets 1 to 5'] },
    { level: 5, items: ['D string, up the neck'] },
    { level: 6, items: ['A string, frets 1 to 5'] },
    { level: 7, items: ['A string, up the neck'] },
    { level: 8, items: ['E string, frets 1 to 5'] },
    { level: 9, items: ['E string, up the neck'] },
    { level: 10, items: ['Moves: two notes'] },
    { level: 11, items: ['Moves: three notes'] },
    { level: 12, items: ['Find it by name, no dot'] },
    { level: 13, items: ['Sharps and flats by name'] }
  ]
};
