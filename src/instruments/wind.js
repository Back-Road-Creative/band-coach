// Extracted from src/app.js MODS.wind (app.js:86-91). Named honestly: today's
// "wind" mod is NOT one instrument. It is a single written-pitch curriculum
// (Wn(...) ids, app.js:56, written numbers 60-79) that gets reinterpreted at
// judging time through a runtime preference, WIND_KINDS (app.js:110), which
// covers seven different transposing instruments (concert, three flavours of
// B flat, two of E flat, F, and a bass-clef group) by adding a per-instrument
// semitone offset in info() (app.js:119). There is one MODS entry, one
// curriculum, and up to seven live transpositions layered on top of it.
// This record captures that one shared curriculum at its literal written
// pitches (concert/treble baseline, transposition 0); the seven selectable
// transpositions are not modeled as separate schema records in this unit.
// Range 60-79 is the lowest and highest Wn(...) value across all ten levels.
export default {
  id: 'wind',
  name: 'Wind and brass (choose your instrument)',
  family: 'wind',
  input: 'mic',
  range: { low: 60, high: 79 },
  transposition: 0,
  clefs: ['treble', 'bass'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['First three notes'] },
    { level: 2, items: ['Two more, going up'] },
    { level: 3, items: ['Going down'] },
    { level: 4, items: ['Down to low C'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['F sharp and B flat'] },
    { level: 7, items: ['Long tones: two steady seconds'] },
    { level: 8, items: ['Moves: three notes'] },
    { level: 9, items: ['Five-note runs'] },
    { level: 10, items: ['The upper notes'] }
  ]
};
