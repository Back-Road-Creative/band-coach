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

// The pitch detector's OTHER instrument-shaped knob, alongside
// rangeForInstrument above: how big a buffer yin() (src/audio/yin.js) needs
// to even see a low note at all. yin's autocorrelation searches lags up to
// (frameSize >> 1) - 1 samples; a fundamental whose period is longer than
// that cap can never be found, no matter how tightly fmin/fmax are set.
// src/audio/pitch-worklet.js used to hardcode frameSize 2048 for every
// instrument (a 1023-sample cap at 48kHz), silently misdetecting a 4-string
// bass's open E (41.2 Hz, ~1165-sample period) as a wrong note around its
// 2nd/3rd-harmonic region, and never locking onto a 5-string bass's open B0
// (30.87 Hz, ~1555-sample period) at all.
//
// The default stays 2048 for everything else on purpose: doubling it to
// 4096 doubles analysis latency (~42.7ms -> ~85.3ms @48kHz), and this app
// times attacks as well as pitches, so only an instrument that actually
// needs the bigger window gets it.
export const MIN_FRAME_SIZE = 2048;

// Headroom above the raw period-in-samples so a genuine note at an
// instrument's lowest string isn't sitting right at the search window's
// edge, the way 2048 left the 4-string bass's open E.
export const FRAME_SIZE_MARGIN = 1.25;

// rec: an instrument record (or any falsy/malformed value, same contract as
// rangeForInstrument). sampleRate: the real AudioContext sample rate the
// frame will actually run at (44.1kHz and 48kHz both matter -- this must not
// be hardcoded to one of them). Returns the smallest power-of-two frame size
// at or above MIN_FRAME_SIZE whose search cap comfortably exceeds the period
// of the instrument's own `range.low`.
export function frameSizeForInstrument(rec, sampleRate) {
  const low = rec && rec.range && rec.range.low;
  if (typeof low !== 'number' || !isFinite(low) || !(sampleRate > 0)) return MIN_FRAME_SIZE;
  const neededTau = (sampleRate / midiToHz(low)) * FRAME_SIZE_MARGIN;
  let frameSize = MIN_FRAME_SIZE;
  while ((frameSize >> 1) - 1 < neededTau) frameSize *= 2;
  return frameSize;
}
