// Wired into MODS['double-bass'] in src/app.js: tuning, name and mic range
// all read from THIS record (rangeForInstrument(byId['double-bass']),
// src/audio/range.js) rather than being restated. Standard orchestral
// tuning, fourths E1 A1 D2 G2 = [28,33,38,43] (sounding pitch). Double bass
// sounds an octave below what is written on the bass-clef staff, so
// transposition is -12 (sounding = written - 12). Range and tuning here are
// in sounding pitch, matching the app's convention for gtr/bass. Range is a
// conservative beginner range: open E string up to exactly first position (5
// semitones) on the G string -- range.high (48) = the open G string (43) +
// 5, not the instrument's full compass. The open E1 (~41.2 Hz) is well below
// the pitch detector's old fixed 2048-sample frame size's working band, the
// same shape of problem bass-5-string's open B0 had -- see
// src/audio/range.js's frameSizeForInstrument, which derives a bigger frame
// from range.low the same way for every instrument, not just this one; the
// mic characterization test proves it rather than assuming it. Curriculum is
// intonation-first -- see violin.js's header for the full reasoning
// (fretless flag + 'sustain' input, maxFret 5, no chordSet), which applies
// identically here.
export default {
  id: 'double-bass',
  name: 'Double bass',
  family: 'bowed',
  input: 'mic',
  range: { low: 28, high: 48 }, // conservative beginner range
  transposition: -12,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [28, 33, 38, 43],
  fretted: false,
  status: 'ready',
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['E string, positions 1 to 5'] },
    { level: 3, items: ['A string, positions 1 to 5'] },
    { level: 4, items: ['D string, positions 1 to 5'] },
    { level: 5, items: ['G string, positions 1 to 5'] },
    { level: 6, items: ['Moves: two notes'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['Find it by name, no dot'] },
    { level: 9, items: ['Sharps and flats by name'] }
  ]
};
