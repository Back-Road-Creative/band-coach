// Pure MIDI-note-name helper for the "How to play it" panel. Kept separate
// and tiny so it is trivially unit tested; matches the naming convention
// src/app.js's own `nname` uses (both route through src/core/note-names.js,
// see setNoteNaming there), so a learner sees the same spellings, in
// whichever system/accidentals they picked, everywhere in the app.

import { name as noteNameFor } from '../../core/note-names.js';

export function pitchClass(midi) {
  return ((Math.round(midi) % 12) + 12) % 12;
}

// e.g. noteName(60) -> 'C4', noteName(61) -> 'C♯4'
export function noteName(midi) {
  return noteNameFor(midi, true);
}

// Every integer MIDI note from low to high, inclusive.
export function chromaticRange(low, high) {
  const out = [];
  for (let m = low; m <= high; m++) out.push(m);
  return out;
}
