// Wired into MODS.violin in src/app.js: tuning, name and mic range all read
// from THIS record (rangeForInstrument(byId.violin), src/audio/range.js)
// rather than being restated. Standard tuning, fifths G3 D4 A4 E5 =
// [55,62,69,76]. Range is a conservative beginner range: open G string up to
// exactly first position (5 semitones) on the E string -- range.high (81) =
// the open E string (76) + 5, not the instrument's full compass.
// Curriculum is intonation-first (bowed strings have no frets, so there is
// no dot to feel for -- see MODS.violin's fretless flag and its 'sustain'
// input in src/app.js), covering the same open-strings-then-per-string shape
// as the fretted stringLevels() curricula, generated with maxFret 5 so every
// item stays inside range.high on the top (E) string. No chordSet: bowed
// double-stops are a different technique, not a mic-detectable chord voicing.
export default {
  id: 'violin',
  name: 'Violin',
  family: 'bowed',
  input: 'mic',
  range: { low: 55, high: 81 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  tuning: [55, 62, 69, 76],
  fretted: false,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['G string, positions 1 to 5'] },
    { level: 3, items: ['D string, positions 1 to 5'] },
    { level: 4, items: ['A string, positions 1 to 5'] },
    { level: 5, items: ['E string, positions 1 to 5'] },
    { level: 6, items: ['Moves: two notes'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['Find it by name, no dot'] },
    { level: 9, items: ['Sharps and flats by name'] }
  ]
};
