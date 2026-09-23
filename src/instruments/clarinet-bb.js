// Wired into MODS['clarinet-bb'] in src/app.js. B flat clarinet sounds a
// major second below what is written, so transposition is -2, matching
// WIND_KINDS.bb in src/app.js's WIND_KINDS table. Range (written, treble
// clef) is a conservative beginner range, sitting entirely in the
// chalumeau (lowest) register, below the break -- no register key needed.
// Fingering data lives in src/instruments/how/keyed-woodwind.js
// (CLARINET_NOTES), which covers the same 55-67 range.
export default {
  id: 'clarinet-bb',
  name: 'Clarinet (B flat)',
  family: 'wind',
  input: 'mic',
  range: { low: 55, high: 67 }, // conservative beginner range, written pitch
  transposition: -2,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['Written G, A and B'] },
    { level: 2, items: ['Add C and D'] },
    { level: 3, items: ['Add E, F and high G'] },
    { level: 4, items: ['Sharps and flats: A flat and C sharp'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Moves: three notes'] },
    { level: 7, items: ['Five-note runs'] }
  ]
};
