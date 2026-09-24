// Wired into MODS.viola in src/app.js: tuning, name and mic range all read
// from THIS record (rangeForInstrument(byId.viola), src/audio/range.js)
// rather than being restated. Standard tuning, fifths C3 G3 D4 A4 =
// [48,55,62,69]. Range is a conservative beginner range: open C string up to
// exactly first position (5 semitones) on the A string -- range.high (74) =
// the open A string (69) + 5, not the instrument's full compass. Curriculum
// is intonation-first -- see violin.js's header for the full reasoning
// (fretless flag + 'sustain' input, maxFret 5, no chordSet), which applies
// identically here.
export default {
  id: 'viola',
  name: 'Viola',
  family: 'bowed',
  input: 'mic',
  range: { low: 48, high: 74 }, // conservative beginner range
  transposition: 0,
  clefs: ['alto'],
  octavePolicy: 'exact',
  tuning: [48, 55, 62, 69],
  fretted: false,
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['C string, positions 1 to 5'] },
    { level: 3, items: ['G string, positions 1 to 5'] },
    { level: 4, items: ['D string, positions 1 to 5'] },
    { level: 5, items: ['A string, positions 1 to 5'] },
    { level: 6, items: ['Moves: two notes'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['Find it by name, no dot'] },
    { level: 9, items: ['Sharps and flats by name'] }
  ]
};
