// Extracted from src/app.js MODS.kbd (app.js:68-76). Range 48-72 is the lowest
// and highest MIDI note reached across all nine levels (app.js:70-75, N(48..72)).
// Keyboard reads exact MIDI pitches, no octave folding, so octavePolicy is exact.
export default {
  id: 'kbd',
  name: 'Keyboard',
  family: 'keys',
  input: 'midi',
  range: { low: 48, high: 72 },
  transposition: 0,
  clefs: ['grand'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['C, D and E'] },
    { level: 2, items: ['Add F and G'] },
    { level: 3, items: ['Add A, B and high C'] },
    { level: 4, items: ['Black keys: F sharp and B flat'] },
    { level: 5, items: ['Black keys: C sharp, E flat, A flat'] },
    { level: 6, items: ['Moves: two notes'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['The octave below'] },
    { level: 9, items: ['Five-note runs'] },
    { level: 10, items: ['Chords: C, F and G'] },
    { level: 11, items: ['Chords: A minor, D minor, E minor'] },
    { level: 12, items: ['Chord changes'] },
    { level: 13, items: ['Hands together: five-finger position (MIDI exact, mic approximate)'] }
  ]
};
