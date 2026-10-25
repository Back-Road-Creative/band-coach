// The one Hz <-> MIDI conversion, plus the player's A4 tuning reference
// (Settings: 415..466 Hz, default 440). Pure: no DOM, no AudioContext.
//
// Offline FILE analysis (src/audio/analysis/*, chords.js, file-frames.js,
// range.js) passes its own `a4` or takes the 440 default -- it never reads the
// player's preference. LIVE-mic sites and the reference tones the app plays
// read it through referencePitch(), set once by app.js on load, on a backup
// restore and on the Settings control -- the same shared-singleton idiom as
// setNoteNaming() in note-names.js.
export const A4_DEFAULT = 440;
export const A4_MIN = 415;
export const A4_MAX = 466;

export const freqToMidi = (freq, a4 = A4_DEFAULT) => 69 + 12 * Math.log2(freq / a4);
export const midiToFreq = (midi, a4 = A4_DEFAULT) => a4 * Math.pow(2, (midi - 69) / 12);

// A real number inside 415..466, rounded to whole Hz (the control steps by 1);
// anything else (missing, text, NaN, out of range) is the standard 440.
export function sanitizeA4(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return A4_DEFAULT;
  const r = Math.round(v);
  return r >= A4_MIN && r <= A4_MAX ? r : A4_DEFAULT;
}

let current = A4_DEFAULT;
export function setReferencePitch(v) { current = sanitizeA4(v); }
export function referencePitch() { return current; }
