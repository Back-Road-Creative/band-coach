// Wired into MODS['bass-5-string'] in src/app.js: tuning, name and mic range
// all read from THIS record (rangeForInstrument(byId['bass-5-string']))
// rather than being restated. Standard 5-string tuning, adding a low B below
// bass.js's EADG: B0 E1 A1 D2 G2 = [23,28,33,38,43], already low-to-high.
// Range extends the open strings by 12 frets, same formula/maxFret as
// bass.js -- a conservative beginner range.
//
// The low B string is modeled here for tuning/tab/fingering purposes (it is
// a real physical string of the instrument) but is DELIBERATELY EXCLUDED
// from the graded curriculum below: the pitch detector cannot hear it.
// Measured directly against the actual runtime pipeline (the AudioWorklet
// path, src/audio/pitch-worklet.js, frameSize 2048 -- not the main-thread
// fallback's 4096-sample buffer, which does have enough samples), calling
// yin() on a pure 30.87 Hz sine (B0, midi 23) returns freq: 0 -- no lock at
// all, because 2048-sample YIN caps its search lag at (frameSize>>1)-1 =
// 1023 samples, and a genuine 30.87 Hz period needs roughly 1550-1600
// samples to autocorrelate against at 44.1-48 kHz, well past that cap. (The
// existing 4-string bass's own open E, 41.2 Hz, sits in the same trap and
// is measurably misdetected there too -- a pre-existing limitation of
// bass.js's shipped 'ready' status, not something this record changes.)
// app.js's MODS['bass-5-string'].levels assignment calls a small
// string-excluding wrapper around stringLevels(tuning, ['B','E','A','D','G'],
// 12, null) that drops every item referencing the B string, so no level in
// this curriculum can ever require crediting a note the mic cannot hear.
// The resulting 13-level curriculum below is therefore textually identical
// to bass.js's: same practice ladder, on an instrument that additionally
// carries an un-graded low string. No chordSet: bass never gets one either.
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
  curriculum: [
    { level: 1, items: ['The open strings'] },
    { level: 2, items: ['E string, frets 1 to 5'] },
    { level: 3, items: ['E string, up the neck'] },
    { level: 4, items: ['A string, frets 1 to 5'] },
    { level: 5, items: ['A string, up the neck'] },
    { level: 6, items: ['D string, frets 1 to 5'] },
    { level: 7, items: ['D string, up the neck'] },
    { level: 8, items: ['G string, frets 1 to 5'] },
    { level: 9, items: ['G string, up the neck'] },
    { level: 10, items: ['Moves: two notes'] },
    { level: 11, items: ['Moves: three notes'] },
    { level: 12, items: ['Find it by name, no dot'] },
    { level: 13, items: ['Sharps and flats by name'] }
  ]
};
