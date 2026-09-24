// D tin whistle. Range comes directly from the fingering table
// (src/instruments/how/recorder-whistle.js's WHISTLE_NOTES: computed from
// the D-major scale pattern, not typed here) so the record can never drift
// out of step with the table it is wired to. That table's own low note
// (WHISTLE_LOW_D = 74, D5) is already documented there as the SOUNDING
// pitch ("a standard high D whistle sounds D5 at the bottom") -- consistent
// with the well-known beginner-notation convention that a D tin whistle is
// written an octave below what it actually sounds (the same octave-only gap
// the descant recorder has, see recorder-descant.js's header). So
// transposition here is +12 (sounding = written + 12), matching
// recorder-descant.js's reasoning; range stays exactly the table's own
// sounding-pitch bounds, unchanged by this unit.
// Curriculum: the D-major scale, first octave only, introduced in scale
// order (D, E, F#, then G, A, then B, C#, finishing on the octave D) --
// mirrors WHISTLE_NOTES[0..7]. See src/app.js's MODS['tin-whistle'].levels
// for the full order.
import { WHISTLE_NOTES } from './how/recorder-whistle.js';

const LOW = WHISTLE_NOTES[0].midi;
const HIGH = WHISTLE_NOTES[WHISTLE_NOTES.length - 1].midi;

export default {
  id: 'tin-whistle',
  name: 'Tin whistle (D)',
  family: 'wind',
  input: 'mic',
  range: { low: LOW, high: HIGH },
  transposition: 12,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'ready',
  provenance: null,
  curriculum: [
    { level: 1, items: ['First three notes: D, E, F sharp'] },
    { level: 2, items: ['Two more, going up: G and A'] },
    { level: 3, items: ['Finishing the octave: B and C sharp'] },
    { level: 4, items: ['The top of the octave: high D'] },
    { level: 5, items: ['Moves: two notes'] },
    { level: 6, items: ['Long tones: two steady seconds'] },
    { level: 7, items: ['Moves: three notes'] },
    { level: 8, items: ['Five-note runs'] }
  ]
};
