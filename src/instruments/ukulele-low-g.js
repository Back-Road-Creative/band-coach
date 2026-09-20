// Wired into MODS['ukulele-low-g'] in src/app.js: tuning, name and mic range
// all read from THIS record (rangeForInstrument(byId['ukulele-low-g']))
// rather than being restated. Same standard-ukulele pitches as uke.js (G3 C4
// E4 A4) but with a low, non-re-entrant G string, so the tuning IS already
// low-to-high: [55,60,64,69]. maxFret is 7, matching uke.js's own beginner
// fret limit (this instrument is the same difficulty as standard ukulele --
// only the G string's octave differs), so range high is the 7th fret on the
// top A string (69+7=76), not the 12-fret formula used for gtr/bass/
// mandolin/banjo/baritone-uke. The lowest open string, G3 (196 Hz), is well
// inside the pitch detector's working band. The 16-level curriculum mirrors
// stringLevels(tuning, ['G','C','E','A'], 7, ['C','Am','F','G7']) at the
// app.js MODS['ukulele-low-g'].levels assignment: it reuses uke.js's own
// chordSet, because the pitch classes of a low-G chord are identical to a
// high-G one (chord listening judges chroma/pitch class, not which octave a
// string rings in -- see app.js's CHORDS/judgeChord) and the same GCEA
// fingering shapes uke.js already assumes apply unchanged here.
export default {
  id: 'ukulele-low-g',
  name: 'Low-G ukulele',
  family: 'fretted',
  input: 'mic',
  range: { low: 55, high: 76 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [55, 60, 64, 69],
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
