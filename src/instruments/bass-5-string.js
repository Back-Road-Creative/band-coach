// Wired into MODS['bass-5-string'] in src/app.js: tuning, name and mic range
// all read from THIS record (rangeForInstrument(byId['bass-5-string']))
// rather than being restated. Standard 5-string tuning, adding a low B below
// bass.js's EADG: B0 E1 A1 D2 G2 = [23,28,33,38,43], already low-to-high.
// Range extends the open strings by 12 frets, same formula/maxFret as
// bass.js -- a conservative beginner range.
//
// The low B string used to be excluded from the graded curriculum: at the
// AudioWorklet pipeline's old fixed frameSize (2048, src/audio/pitch-worklet.js),
// a pure 30.87 Hz sine (B0, midi 23) returned freq: 0 -- no lock at all,
// because 2048-sample YIN caps its search lag at (frameSize>>1)-1 = 1023
// samples, and a genuine 30.87 Hz period needs roughly 1550-1600 samples to
// autocorrelate against at 44.1-48 kHz, well past that cap. (The 4-string
// bass's own open E, 41.2 Hz, sat in the same trap.)
//
// src/audio/range.js's frameSizeForInstrument now derives the worklet's
// analysis frame size from each instrument's own `range.low` instead of a
// single hardcoded 2048: at 4096 (the size it picks for both this record and
// bass.js), (frameSize>>1)-1 = 2047 samples comfortably clears B0's ~1554-1600
// sample period, and yin() resolves it cleanly (see tests/unit/yin.test.mjs
// and tests/unit/range.test.mjs). The B string is therefore graded like every
// other string below; no exclusion wrapper is needed any more (app.js's
// MODS['bass-5-string'].levels now calls the same plain stringLevels(tuning,
// ['B','E','A','D','G'], 12, null) the other fretted instruments use). No
// chordSet: bass never gets one either.
export default {
  id: 'bass-5-string',
  name: '5-string bass',
  family: 'fretted',
  input: 'mic',
  range: { low: 23, high: 55 }, // conservative beginner range
  transposition: 0,
  clefs: ['bass'],
  octavePolicy: 'exact',
  tuning: [23, 28, 33, 38, 43],
  fretted: true,
  writtenOctaveUp: true,
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['B string, frets 1 to 5'] },
    { level: 3, items: ['B string, up the neck'] },
    { level: 4, items: ['E string, frets 1 to 5'] },
    { level: 5, items: ['E string, up the neck'] },
    { level: 6, items: ['A string, frets 1 to 5'] },
    { level: 7, items: ['A string, up the neck'] },
    { level: 8, items: ['D string, frets 1 to 5'] },
    { level: 9, items: ['D string, up the neck'] },
    { level: 10, items: ['G string, frets 1 to 5'] },
    { level: 11, items: ['G string, up the neck'] },
    { level: 12, items: ['Moves: two notes'] },
    { level: 13, items: ['Moves: three notes'] },
    { level: 14, items: ['Find it by name, no dot'] },
    { level: 15, items: ['Sharps and flats by name'] }
  ]
};
