// Wired into MODS['sax-alto-eb'] in src/app.js. E flat alto sax sounds a
// major sixth below what is written, so transposition is -9, matching
// WIND_KINDS.eb in src/app.js's WIND_KINDS table. Range (written, treble
// clef): Bb3-G4 (58-67) -- a saxophone's lowest written note is Bb3;
// nothing written below it exists on the horn (see
// src/instruments/how/keyed-woodwind.js's SAX_NOTES and its top-comment
// KNOWN ISSUE, fixed here). Fingering data lives in that same file
// (SAX_NOTES, shared by both sax records -- all saxes share written
// fingerings).
export default {
  id: 'sax-alto-eb',
  name: 'Alto sax (E flat)',
  family: 'wind',
  input: 'mic',
  range: { low: 58, high: 67 }, // Bb3-G4, the horn's actual lowest written note
  transposition: -9,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['Written B flat, B and C'] },
    { level: 2, items: ['Add D and E'] },
    { level: 3, items: ['Add F, F sharp and high G'] },
    { level: 4, items: ['Sharps and flats: E flat and C sharp'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
