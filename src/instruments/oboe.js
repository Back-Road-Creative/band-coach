// Not in today's MODS. Concert-pitch instrument, transposition 0, matching
// WIND_KINDS.c in src/app.js (~line 304): 'Concert pitch: flute, oboe,
// violin' already names oboe there, so oboe needs no new WIND_KINDS entry
// -- a learner could already select "oboe" conceptually by choosing the
// concert-pitch group in the wind mod. This record exists for the
// notation/mic-range/curriculum machinery the registry drives; it does not
// change what WIND_KINDS offers.
//
// Range (written = concert pitch, treble clef): D4-D5 (62-74), one octave.
// An oboe's full written compass runs roughly Bb3 to G6, but this repo's
// convention for a wind record with no curriculum written yet is a
// conservative ONE-OCTAVE beginner range in the easiest register, not the
// instrument's full compass (see flute.js: 60-72, clarinet-bb.js: 55-67,
// both 12 semitones). D4-D5 is the oboe's steadiest speaking register for a
// first-year student: the low Bb3-C4 notes need more embouchure/support
// than a beginner reliably has, and anything above D5/E5 starts needing the
// octave (register) key and more voicing control. D4-D5 is matched to that
// same beginner-band convention rather than the full range.
//
// No fingering data is attached. src/instruments/how/ has no data model for
// a keyed Boehm-system woodwind: recorder-whistle.js's typed hole-pattern
// table only fits an open/closed-hole instrument (recorder, tin whistle),
// and brass.js's valve/slide arithmetic does not apply to a reed instrument
// with keys, not valves. Guessing a fingering chart would teach a wrong
// habit, so curriculum stays [] and no fingering table is added, exactly
// like flute.js and clarinet-bb.js do today.
export default {
  id: 'oboe',
  name: 'Oboe',
  family: 'wind',
  input: 'mic',
  range: { low: 62, high: 74 }, // conservative beginner range, written pitch
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
