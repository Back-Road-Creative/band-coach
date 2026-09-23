// Wired into MODS['sax-tenor-bb'] in src/app.js. B flat tenor sax sounds a
// major ninth (an octave plus a major second) below what is written, so
// transposition is -14, matching WIND_KINDS.bbt in src/app.js's WIND_KINDS
// table. Range (written, treble clef): Bb3-G4 (58-67) -- same reasoning and
// fix as sax-alto-eb.js: a saxophone's lowest written note is Bb3, and both
// sax sizes read the same written fingering chart (SAX_NOTES in
// src/instruments/how/keyed-woodwind.js).
export default {
  id: 'sax-tenor-bb',
  name: 'Tenor sax (B flat)',
  family: 'wind',
  input: 'mic',
  range: { low: 58, high: 67 }, // Bb3-G4, the horn's actual lowest written note
  transposition: -14,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
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
