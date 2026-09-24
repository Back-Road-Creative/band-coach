// Wired into MODS.flute in src/app.js. Concert-pitch instrument,
// transposition 0, matching WIND_KINDS.c in src/app.js's WIND_KINDS table.
// Range (treble clef) is a conservative beginner range, not the
// instrument's full compass. Fingering data lives in
// src/instruments/how/keyed-woodwind.js (FLUTE_NOTES), which covers the
// same 60-72 range. Curriculum follows the same beginner-order shape the
// brass records use (see trumpet-bb.js): low three notes first, then two
// more, then up to the top, then the one accidental in this range, then
// moves and runs.
export default {
  id: 'flute',
  name: 'Flute',
  family: 'wind',
  input: 'mic',
  range: { low: 60, high: 72 }, // conservative beginner range
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['Written C, D and E'] },
    { level: 2, items: ['Add F and G'] },
    { level: 3, items: ['Add A, B and high C'] },
    { level: 4, items: ['Sharps and flats: F sharp and B flat'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
