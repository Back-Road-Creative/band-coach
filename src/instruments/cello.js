// Wired into MODS.cello in src/app.js: tuning, name and mic range all read
// from THIS record (rangeForInstrument(byId.cello), src/audio/range.js)
// rather than being restated. Standard tuning, fifths C2 G2 D3 A3 =
// [36,43,50,57] (an octave below viola). Range is a conservative beginner
// range: open C string up to exactly first position (5 semitones) on the A
// string -- range.high (62) = the open A string (57) + 5, not the
// instrument's full compass. Curriculum is intonation-first -- see
// violin.js's header for the full reasoning (fretless flag + 'sustain'
// input, maxFret 5, no chordSet), which applies identically here.
export default {
  id: 'cello',
  name: 'Cello',
  family: 'bowed',
  input: 'mic',
  range: { low: 36, high: 62 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [36, 43, 50, 57],
  fretted: false,
  status: 'ready',
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
