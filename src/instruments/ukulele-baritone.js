// Wired into MODS['ukulele-baritone'] in src/app.js: tuning, name and mic
// range all read from THIS record (rangeForInstrument(byId['ukulele-baritone']))
// rather than being restated. Standard baritone tuning (like the top four
// guitar strings), D3 G3 B3 E4 = [50,55,59,64], already low-to-high. Range
// extends the open strings by 12 frets, same maxFret as gtr.js/bass.js --
// baritone's longer scale and standard tuning play more like a small guitar
// than a soprano/concert uke, so it gets the guitar-style fret ceiling
// rather than uke.js's 7. The lowest open string, D3 (146.8 Hz), is well
// inside the pitch detector's working band. The 13-level curriculum mirrors
// stringLevels(tuning, ['D','G','B','E'], 12, null) at the app.js
// MODS['ukulele-baritone'].levels assignment -- no chordSet: the app's C/
// Am/F/G7 shapes (CHORDS in app.js) are fingerings for GCEA (uke.js/
// ukulele-low-g.js) tuning, not DGBE, so this passes null rather than
// inventing baritone-specific shapes nothing here has verified.
export default {
  id: 'ukulele-baritone',
  name: 'Baritone ukulele',
  family: 'fretted',
  input: 'mic',
  range: { low: 50, high: 76 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [50, 55, 59, 64],
  fretted: true,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['D string, frets 1 to 5'] },
    { level: 3, items: ['D string, up the neck'] },
    { level: 4, items: ['G string, frets 1 to 5'] },
    { level: 5, items: ['G string, up the neck'] },
    { level: 6, items: ['B string, frets 1 to 5'] },
    { level: 7, items: ['B string, up the neck'] },
    { level: 8, items: ['E string, frets 1 to 5'] },
    { level: 9, items: ['E string, up the neck'] },
    { level: 10, items: ['Moves: two notes'] },
    { level: 11, items: ['Moves: three notes'] },
    { level: 12, items: ['Find it by name, no dot'] },
    { level: 13, items: ['Sharps and flats by name'] }
  ]
};
