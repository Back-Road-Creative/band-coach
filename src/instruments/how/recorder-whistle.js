// Recorder and tin-whistle fingering — UNLIKE the rest of this directory,
// these two really are small typed tables: fingering-to-hole-pattern is not
// something that falls out of a formula the way valve drops or harmonica
// bends do. Kept deliberately short (diatonic notes only, two octaves at
// most) and NEEDS A MUSICIAN'S CHECK — see the unit report. Zero
// dependencies; pure data + lookups; no DOM.
//
// Wiring pass: `fingeringFor(midi, 'recorder' | 'whistle')` returns the hole
// pattern (or null if the pitch isn't in this table's short diatonic
// range). 'x' = covered, 'o' = open, 'h' = half-covered, 'p' = thumb
// pinched open a sliver (octave vent, recorder only).

// Soprano (descant) recorder, baroque fingering, main diatonic notes C5-D6
// (written, matching src/instruments/recorder-descant.js's treble clef).
// Hole order (8 positions): thumb, then finger holes 1-7 (a soprano recorder
// has seven finger holes). F5 is the baroque forked fingering.
export const RECORDER_NOTES = [
  { midi: 72, name: 'C5', holes: 'xxxxxxxx' },
  { midi: 74, name: 'D5', holes: 'xxxxxxxo' },
  { midi: 76, name: 'E5', holes: 'xxxxxxoo' },
  { midi: 77, name: 'F5', holes: 'xxxxxoxx' },
  { midi: 79, name: 'G5', holes: 'xxxxoooo' },
  { midi: 81, name: 'A5', holes: 'xxxooooo' },
  { midi: 83, name: 'B5', holes: 'xxoooooo' },
  { midi: 84, name: 'C6', holes: 'xoxooooo' },
  { midi: 86, name: 'D6', holes: 'ooxooooo' }
];

// D tin whistle, two octaves (D5-D7 — WHISTLE_LOW_D below is 74, D5, not
// D4 as an earlier version of this comment said). Six-hole fingerings repeat between the
// two octaves; the second octave is the same hole pattern overblown harder,
// flagged with `overblow: true`. Hole order (6 holes): top to bottom, 1-6.
const WHISTLE_HOLE_PATTERNS = [
  { name: 'D', holes: 'xxxxxx' },
  { name: 'E', holes: 'xxxxxo' },
  { name: 'F#', holes: 'xxxxoo' },
  { name: 'G', holes: 'xxxooo' },
  { name: 'A', holes: 'xxoooo' },
  { name: 'B', holes: 'xooooo' },
  { name: 'C#', holes: 'oooooo' }
];

const WHISTLE_LOW_D = 74; // D5: a standard high D whistle sounds D5 at the bottom

// D-major scale degrees across two full octaves, tonic to tonic (15 notes:
// 7 scale degrees per octave plus the octave-closing tonic at each end).
// Each degree's hole pattern repeats every 7 notes (the fingering is the
// same shape an octave up, just overblown harder).
const SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];

export const WHISTLE_NOTES = SCALE_SEMITONES.map((semitones, i) => {
  const pattern = WHISTLE_HOLE_PATTERNS[i % 7];
  return {
    midi: WHISTLE_LOW_D + semitones,
    // The octave number turns over at C, so C#6 follows B5.
    name: pattern.name + (Math.floor((WHISTLE_LOW_D + semitones) / 12) - 1),
    // Second-octave D is vented: top hole open, the rest covered.
    holes: i === 7 ? 'oxxxxx' : pattern.holes,
    overblow: semitones >= 12
  };
});

export function fingeringFor(midi, instrument) {
  const table = instrument === 'recorder' ? RECORDER_NOTES : instrument === 'whistle' ? WHISTLE_NOTES : null;
  if (!table) throw new Error('unknown instrument ' + JSON.stringify(instrument));
  return table.find(n => n.midi === midi) || null;
}
