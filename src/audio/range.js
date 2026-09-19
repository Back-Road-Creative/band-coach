// Turns an instrument record (src/instruments/schema.js shape: { range: {
// low, high } } in MIDI notes) into the Hz search window the pitch detector
// (src/audio/yin.js, src/audio/pitch-worklet.js) should look inside, instead
// of every caller running the detector across a generic wide band. A narrow,
// instrument-shaped window matters for YIN specifically: its autocorrelation
// picks the best-scoring lag inside [fmin, fmax], and on a low, quiet
// fundamental a wide window lets it lock onto a subharmonic or an overtone
// (an "octave error") that a tighter window would have excluded outright. A
// wide window also costs more CPU per call for no benefit on a high
// instrument that will never sound near the bottom of it.
//
// Pure and dependency-free on purpose: called from the main thread (app.js,
// src/ui/songs.js, src/ui/editor/record.js) and embedded into the
// AudioWorklet's generated source (src/audio/pitch-worklet.js) alike.

// The app's original, pre-instrument-record generic search band: roughly B0
// (a low double-bass open string) to G6 (well above anything sung or played
// here). Used whenever no instrument record is available -- a tool with no
// instrument picker (the "Capture a melody" tool, which is deliberately
// instrument-agnostic: sung, hummed, whistled or played on anything) or a
// panel that has not chosen one yet.
export const FALLBACK_RANGE = Object.freeze({ fmin: 36, fmax: 1600 });

// How far past an instrument's declared beginner range (src/instruments/*.js
// `range.low`/`range.high`, in MIDI notes) the search window reaches, in
// semitones. Three semitones covers a fingering or breath a little sharp or
// flat of the extreme notes, or one fret/key past the written beginner
// range, without reopening a full octave either side -- the interval YIN's
// autocorrelation most often mistakes a fundamental for, which is exactly
// the failure mode narrowing the range is meant to remove.
export const MARGIN_SEMITONES = 3;

// A4 = MIDI 69 = 440 Hz, the standard reference this app tunes to everywhere
// else (see app.js's own `mfreq`/`fmidi`).
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// rec: an instrument record (src/instruments/schema.js shape) or any
// falsy/malformed value. Returns { fmin, fmax } in Hz, rounded to whole Hz
// to match the app's existing hand-written MODS fmin/fmax values. Falls back
// to FALLBACK_RANGE when `rec` has no usable numeric range -- never throws,
// so a caller that has not yet picked an instrument (or picked one this
// build does not know about) still gets a safe, working search window.
export function rangeForInstrument(rec, marginSemitones = MARGIN_SEMITONES) {
  const range = rec && rec.range;
  const low = range && range.low;
  const high = range && range.high;
  if (typeof low !== 'number' || !isFinite(low) || typeof high !== 'number' || !isFinite(high)) {
    return { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax };
  }
  const fmin = Math.max(1, Math.round(midiToHz(low - marginSemitones)));
  const fmax = Math.round(midiToHz(high + marginSemitones));
  return { fmin, fmax };
}
