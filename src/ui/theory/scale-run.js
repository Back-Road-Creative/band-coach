// Turns a scale's interval pattern into an ascending run of absolute MIDI
// notes (tonic first, tonic-plus-octave last) for staff display and playback.
// src/core/theory/scales.js's scale() only returns pitch classes (0-11), so
// climbing a real staff needs this cumulative-semitone walk on top of it.
import { PATTERNS } from '../../core/theory/scales.js';

export function ascendingMidis(tonicMidi, type) {
  const pattern = PATTERNS[type];
  if (!pattern) throw new Error('unknown scale type: ' + JSON.stringify(type));
  const midis = [tonicMidi];
  let cumulative = 0;
  for (const step of pattern) {
    cumulative += step;
    midis.push(tonicMidi + cumulative);
  }
  return midis;
}

// A chord's pitch classes, stacked as ascending MIDI notes above `rootMidi`
// (root first). Relies on every quality in chords.js using intervals < 12
// semitones, so `(pc - rootPc) mod 12` recovers the original interval.
export function chordMidis(rootMidi, rootPc, pitchClasses) {
  const mod12 = (n) => ((n % 12) + 12) % 12;
  return pitchClasses.map((pc) => rootMidi + mod12(pc - rootPc));
}
