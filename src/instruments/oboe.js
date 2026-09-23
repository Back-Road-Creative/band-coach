// Wired into MODS.oboe in src/app.js. Concert-pitch instrument,
// transposition 0, matching WIND_KINDS.c in src/app.js's WIND_KINDS table:
// 'Concert pitch: flute, oboe, violin' already names oboe there, so oboe
// needs no new WIND_KINDS entry -- MODS.oboe gives it its own fixed
// windKind ('c') the same way the brass trio and the other keyed woodwinds
// do, so its written notes never depend on the learner's generic wind
// preference.
//
// Range (written = concert pitch, treble clef): D4-D5 (62-74), one octave.
// An oboe's full written compass runs roughly Bb3 to G6, but this repo's
// convention for a wind record is a conservative ONE-OCTAVE beginner range
// in the easiest register, not the instrument's full compass (see
// flute.js: 60-72, clarinet-bb.js: 55-67, both 12 semitones). D4-D5 is the
// oboe's steadiest speaking register for a first-year student: the low
// Bb3-C4 notes need more embouchure/support than a beginner reliably has,
// and anything above D5/E5 starts needing the octave (register) key and
// more voicing control.
//
// Fingering data lives in src/instruments/how/keyed-woodwind.js
// (OBOE_NOTES), which covers the same 62-74 range -- see that file's top
// comment for the confidence caveat on the top three notes (half-hole
// technique).
export default {
  id: 'oboe',
  name: 'Oboe',
  family: 'wind',
  input: 'mic',
  range: { low: 62, high: 74 }, // conservative beginner range, written pitch
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['Written D, E and F sharp'] },
    { level: 2, items: ['Add G and A'] },
    { level: 3, items: ['Add B, C sharp and high D'] },
    { level: 4, items: ['Sharps and flats: E flat and G sharp'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
