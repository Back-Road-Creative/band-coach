// Wiring: chromaFromSpectrum(magnitude, sampleRate, fftSize, opts) turns one FFTProcessor
// magnitude spectrum into a 12-bin Float32Array chroma vector (index 0 = C, ... 11 = B).
// estimateTuningCents(magnitudeFrames, sampleRate, fftSize) looks at a handful of magnitude
// spectra and returns a cents offset from A4=440 to feed back into chromaFromSpectrum's
// `a4` option. beatSynchronousChroma folds per-frame chroma to one vector per beat for
// key.js/chords.js.

const MIN_FREQ = 55, MAX_FREQ = 5000; // ~A1 .. well above the top of a vocal/instrument fundamental

const freqToMidi = (freq, a4) => 69 + 12 * Math.log2(freq / a4);

export function chromaFromSpectrum(magnitude, sampleRate, fftSize, opts = {}) {
  const a4 = opts.a4 ?? 440;
  const minFreq = opts.minFreq ?? MIN_FREQ;
  const maxFreq = opts.maxFreq ?? MAX_FREQ;
  const out = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  for (let i = 1; i < magnitude.length; i++) {
    const freq = i * binHz;
    if (freq < minFreq || freq > maxFreq) continue;
    const amp = magnitude[i];
    if (amp <= 0) continue;
    const pc = ((Math.round(freqToMidi(freq, a4)) % 12) + 12) % 12;
    out[pc] += amp;
  }
  return out;
}

// Quadratic (parabolic) interpolation of a magnitude-spectrum local peak at bin i, refining
// the raw bin-quantised frequency to sub-bin precision — a bin's own width is often tens of
// cents wide, far coarser than the tuning deviations we're trying to measure.
function interpolatedPeakBin(magnitude, i) {
  const yMinus = magnitude[i - 1] ?? 0;
  const y0 = magnitude[i];
  const yPlus = magnitude[i + 1] ?? 0;
  const denom = yMinus - 2 * y0 + yPlus;
  if (denom === 0) return i;
  const offset = (0.5 * (yMinus - yPlus)) / denom;
  return i + Math.max(-0.5, Math.min(0.5, offset));
}

// Histogram-of-deviation tuning estimate: for each prominent spectral peak in the given
// frames, interpolate its true frequency, measure its cents deviation (-50..+50) from the
// nearest equal-tempered A440 note, weight by peak magnitude, and report the mode. Handles
// A4 != 440 (detuned recordings, pitched-down mixes, slightly-flat/sharp live takes).
export function estimateTuningCents(magnitudeFrames, sampleRate, fftSize) {
  const minFreq = 80;
  const maxFreq = 2000;
  const binHz = sampleRate / fftSize;
  const histogram = new Float64Array(100); // cents -50..49, offset by +50
  let totalWeight = 0;
  for (const magnitude of magnitudeFrames) {
    for (let i = 2; i < magnitude.length - 2; i++) {
      const freq = i * binHz;
      if (freq < minFreq || freq > maxFreq) continue;
      const amp = magnitude[i];
      if (amp <= 0 || amp < magnitude[i - 1] || amp < magnitude[i + 1]) continue; // local maxima only
      const freqRefined = interpolatedPeakBin(magnitude, i) * binHz;
      const midi = freqToMidi(freqRefined, 440);
      const centsOff = (midi - Math.round(midi)) * 100;
      const idx = Math.max(0, Math.min(99, Math.round(centsOff) + 50));
      histogram[idx] += amp;
      totalWeight += amp;
    }
  }
  if (totalWeight === 0) return 0;
  let bestIdx = 0, bestVal = -1;
  for (let i = 0; i < 100; i++) if (histogram[i] > bestVal) { bestVal = histogram[i]; bestIdx = i; }
  return bestIdx - 50;
}

export function chromaDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < 12; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); sum += d * d; }
  return Math.sqrt(sum);
}

// chromaFrames: array of 12-length chroma vectors, one per analysis hop, aligned with
// frameTimes (seconds). beats: ascending beat times (seconds). Returns one averaged
// 12-length Float32Array per beat, covering [beats[i], beats[i+1]) (last beat runs to the
// end of the frames).
export function beatSynchronousChroma(chromaFrames, frameTimes, beats) {
  const result = [];
  for (let b = 0; b < beats.length; b++) {
    const t0 = beats[b];
    const t1 = b + 1 < beats.length ? beats[b + 1] : Infinity;
    const acc = new Float32Array(12);
    let count = 0;
    for (let f = 0; f < frameTimes.length; f++) {
      if (frameTimes[f] >= t0 && frameTimes[f] < t1) {
        const frame = chromaFrames[f];
        for (let k = 0; k < 12; k++) acc[k] += frame[k];
        count++;
      }
    }
    if (count > 0) for (let k = 0; k < 12; k++) acc[k] /= count;
    result.push(acc);
  }
  return result;
}
