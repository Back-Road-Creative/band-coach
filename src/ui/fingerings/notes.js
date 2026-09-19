// Pure MIDI-note-name helper for the "How to play it" panel. Kept separate
// and tiny so it is trivially unit tested; matches the naming convention
// src/app.js's own (unexported) `nname` uses, so a learner sees the same
// spellings everywhere in the app.

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function pitchClass(midi) {
  return ((Math.round(midi) % 12) + 12) % 12;
}

// e.g. noteName(60) -> 'C4', noteName(61) -> 'C♯4'
export function noteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NAMES[pitchClass(midi)] + octave;
}

// Every integer MIDI note from low to high, inclusive.
export function chromaticRange(low, high) {
  const out = [];
  for (let m = low; m <= high; m++) out.push(m);
  return out;
}
