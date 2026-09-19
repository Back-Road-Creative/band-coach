// D tin whistle. Range comes directly from the fingering table
// (src/instruments/how/recorder-whistle.js's WHISTLE_NOTES: computed from
// the D-major scale pattern, not typed here) so the record can never drift
// out of step with the table it is wired to.
// Notated at sounding pitch, like the descant recorder (transposition 0);
// treble clef; octavePolicy exact (mic pitch detection, no octave leeway).
// Not in today's MODS: every instrument modelled since the app.js
// extraction that wasn't already a MODS key (violin, mandolin, flute, the
// other bowed/fretted/wind records) is status 'planned' regardless of how
// complete its fingering data is, per tests/unit/instruments.test.mjs's
// "READY instrument ids match the instrument ids in today's MODS" check.
// Curriculum not written yet, so status is planned and curriculum is [].
import { WHISTLE_NOTES } from './how/recorder-whistle.js';

const LOW = WHISTLE_NOTES[0].midi;
const HIGH = WHISTLE_NOTES[WHISTLE_NOTES.length - 1].midi;

export default {
  id: 'tin-whistle',
  name: 'Tin whistle (D)',
  family: 'wind',
  input: 'mic',
  range: { low: LOW, high: HIGH },
  transposition: 0,
  clefs: ['treble'],
  octavePolicy: 'exact',
  status: 'planned',
  curriculum: []
};
