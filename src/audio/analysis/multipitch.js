// Multipitch (polyphony) estimation: harmonic-sum salience over a per-semitone
// log-frequency grid, built on top of the linear-frequency FFT in fft.js, then
// iterative peak picking with harmonic cancellation (Klapuri-style) to pull
// out up to a handful of simultaneous notes. Pure functions only -- caller
// supplies a magnitude spectrum (from FFTProcessor.process or magnitudeSpectrum)
// or plain PCM; no DOM, no AudioContext, no wall-clock. NOT wired into
// transcribe.js or the UI here -- that is a later unit's job.

import { FFTProcessor } from './fft.js';

// Standard 12-TET reference: A4 = MIDI 69 = 440 Hz.
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Fractional FFT bin index for a frequency, given sampleRate/fftSize.
function freqToBin(freq, sampleRate, fftSize) {
  return (freq * fftSize) / sampleRate;
}

// Linearly interpolated magnitude at a fractional bin index (0 outside range).
function magAt(magSpectrum, bin) {
  const lo = Math.floor(bin);
  if (lo < 0 || lo >= magSpectrum.length - 1) return 0;
  const frac = bin - lo;
  return magSpectrum[lo] * (1 - frac) + magSpectrum[lo + 1] * frac;
}

// Harmonic-sum salience per MIDI semitone over [minMidi, maxMidi]: for each
// candidate fundamental, sum interpolated magnitude at its first `harmonics`
// integer multiples, each weighted 1/h. This 1/h decay is what lets the true
// fundamental (weight 1 at h=1) out-score a subharmonic candidate an octave
// or a twelfth below it -- that candidate only picks up the real tone's
// energy at its *even* (or every-third, ...) harmonics, each already
// discounted by a larger h. Returns a plain Float32Array indexed from 0 ==
// minMidi; caller keeps track of minMidi itself (see detectPitches).
export function salienceFrame(magSpectrum, sampleRate, fftSize, opts = {}) {
  const { minMidi = 36, maxMidi = 96, harmonics = 5 } = opts;
  const nyquistBin = magSpectrum.length - 1;
  const out = new Float32Array(maxMidi - minMidi + 1);
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const f0 = midiToFreq(midi);
    let sum = 0;
    for (let h = 1; h <= harmonics; h++) {
      const bin = freqToBin(f0 * h, sampleRate, fftSize);
      if (bin >= nyquistBin) break;
      sum += magAt(magSpectrum, bin) / h;
    }
    out[midi - minMidi] = sum;
  }
  return out;
}

// Attenuates (not zeroes) a small bin window around each of a picked note's
// harmonics, in place, on a *working copy* of the spectrum the caller owns.
// Soft attenuation -- rather than zeroing -- matters when two real notes
// share a harmonic (e.g. a perfect twelfth: the upper note sits exactly on
// the lower note's 3rd harmonic): zeroing would erase the upper note along
// with the lower one's harmonic energy; a partial cut still suppresses the
// lower note enough that it won't be re-picked, while leaving enough of the
// coincident upper note's own energy for the next iteration to find it.
function cancelHarmonics(work, midi, sampleRate, fftSize, opts = {}) {
  const { harmonics = 5, cancelHarmonicCount = harmonics + 3, attenuation = 0.1, binSpread = 2 } = opts;
  const f0 = midiToFreq(midi);
  const nyquistBin = work.length - 1;
  for (let h = 1; h <= cancelHarmonicCount; h++) {
    const bin = freqToBin(f0 * h, sampleRate, fftSize);
    if (bin >= nyquistBin) break;
    const centre = Math.round(bin);
    for (let b = Math.max(0, centre - binSpread); b <= Math.min(nyquistBin, centre + binSpread); b++) {
      work[b] *= attenuation;
    }
  }
}

// Iterative peak-picking over the salience grid: pick the loudest remaining
// candidate, record it, cancel its harmonics out of a working copy of the
// spectrum, and repeat until maxVoices is reached or the next candidate's
// salience falls below `threshold` * the very first (loudest) pick's
// salience -- an adaptive floor so one absolute number doesn't have to work
// across wildly different input loudness. Returns [{ midi, salience }, ...]
// loudest first; [] for silence or an all-below-threshold spectrum.
export function detectPitches(magSpectrum, sampleRate, fftSize, opts = {}) {
  const { maxVoices = 4, threshold = 0.12, minMidi = 36, maxMidi = 96, harmonics = 5 } = opts;
  const work = Float32Array.from(magSpectrum);
  const results = [];
  let firstSalience = null;
  for (let voice = 0; voice < maxVoices; voice++) {
    const salience = salienceFrame(work, sampleRate, fftSize, { minMidi, maxMidi, harmonics });
    let bestIdx = -1, bestVal = -Infinity;
    for (let i = 0; i < salience.length; i++) if (salience[i] > bestVal) { bestVal = salience[i]; bestIdx = i; }
    if (bestIdx < 0 || bestVal <= 0) break;
    if (firstSalience === null) firstSalience = bestVal;
    if (firstSalience <= 0 || bestVal < threshold * firstSalience) break;
    const midi = minMidi + bestIdx;
    results.push({ midi, salience: bestVal });
    cancelHarmonics(work, midi, sampleRate, fftSize, { harmonics });
  }
  return results;
}

// End-to-end: plain-PCM Float32Array in, note events out ({ onset, midi },
// seconds), by hopping FFTProcessor frames across the signal, running
// detectPitches per frame, and turning the per-frame per-voice pitch
// detections into notes -- a MIDI is "on" for as long as it keeps getting
// re-detected within `gapFrames` of its last sighting (bridges a single
// missed frame from spectral noise) and is only kept if it lasted at least
// `minFrames` frames (drops one-frame spurious picks).
export function multipitchTrack(pcm, sampleRate, opts = {}) {
  const { fftSize = 16384, hopSize = fftSize / 4, gapFrames = 1, minFrames = 3, ...detectOpts } = opts;
  const proc = new FFTProcessor(fftSize);
  const frameSeconds = hopSize / sampleRate;

  // active[midi] = { startFrame, lastSeenFrame }
  const active = new Map();
  const notes = [];
  const closeNote = (midi, info, endedAtFrame) => {
    const lengthFrames = endedAtFrame - info.startFrame;
    if (lengthFrames >= minFrames) notes.push({ onset: info.startFrame * frameSeconds, midi });
  };

  let frameIndex = 0;
  for (let start = 0; start + fftSize <= pcm.length; start += hopSize, frameIndex++) {
    const mag = proc.process(pcm.subarray(start, start + fftSize));
    const picks = detectPitches(mag, sampleRate, fftSize, detectOpts);
    const seen = new Set(picks.map((p) => p.midi));
    for (const midi of seen) {
      if (!active.has(midi)) active.set(midi, { startFrame: frameIndex, lastSeenFrame: frameIndex });
      else active.get(midi).lastSeenFrame = frameIndex;
    }
    for (const [midi, info] of Array.from(active.entries())) {
      if (!seen.has(midi) && frameIndex - info.lastSeenFrame > gapFrames) {
        closeNote(midi, info, info.lastSeenFrame + 1);
        active.delete(midi);
      }
    }
  }
  for (const [midi, info] of active.entries()) closeNote(midi, info, frameIndex);

  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi);
  return notes;
}
