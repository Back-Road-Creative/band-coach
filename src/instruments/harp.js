// Extracted from src/app.js MODS.harp (app.js:134-139), for a 10-hole diatonic
// harmonica in the key of C. Range 60-96 is the min/max of HARP.b and HARP.d
// (app.js:132). Harmonica holes sound one fixed pitch each, no octave choice,
// so octavePolicy is exact.
export default {
  id: 'harp',
  name: 'Harmonica',
  family: 'free-reed',
  input: 'mic',
  range: { low: 60, high: 96 },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  curriculum: [
    { level: 1, items: ['Blow holes 4, 5 and 6'] },
    { level: 2, items: ['Draw holes 4, 5 and 6'] },
    { level: 3, items: ['Moves: blow to draw'] },
    { level: 4, items: ['Hole 7 completes the scale'] },
    { level: 5, items: ['Scale runs of three'] },
    { level: 6, items: ['The low end: holes 1 to 3'] },
    { level: 7, items: ['The top end: holes 8 to 10'] },
    { level: 8, items: ['Long tones: two steady seconds'] },
    { level: 9, items: ['Runs of four'] }
  ]
};
