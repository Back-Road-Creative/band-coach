// Wiring: import { FFTProcessor, hannWindow, magnitudeSpectrum, fft }; construct one
// FFTProcessor per frame size and call .process(frame) per hop. No DOM/AudioContext use
// here — caller supplies plain Float32Array PCM.

// In-place radix-2 Cooley-Tukey FFT (decimation-in-time, iterative). re/im must be
// same-length power-of-two arrays; transformed in place.
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re/im length mismatch');
  if (n === 0 || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let j = 0; j < half; j++) {
        const aRe = re[i + j], aIm = im[i + j];
        const bRe = re[i + j + half], bIm = im[i + j + half];
        const tRe = bRe * curWr - bIm * curWi;
        const tIm = bRe * curWi + bIm * curWr;
        re[i + j] = aRe + tRe; im[i + j] = aIm + tIm;
        re[i + j + half] = aRe - tRe; im[i + j + half] = aIm - tIm;
        const nextWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr; curWr = nextWr;
      }
    }
  }
}

// Periodic Hann window (0.5 - 0.5*cos(2*pi*n/N)) — the conventional STFT analysis window.
export function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

// out length must be size/2 + 1 (non-negative frequency bins only).
export function magnitudeSpectrum(re, im, out) {
  const bins = re.length / 2 + 1;
  for (let i = 0; i < bins; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

// Pre-allocated windowed-FFT-plus-magnitude helper: one instance per frame size, reused
// across every hop with zero per-frame allocation.
export class FFTProcessor {
  constructor(size) {
    if (size <= 0 || (size & (size - 1)) !== 0) throw new Error('FFTProcessor: size must be a power of two');
    this.size = size;
    this.window = hannWindow(size);
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.magnitude = new Float32Array(size / 2 + 1);
  }
  // frame: Float32Array of length === this.size. Returns this.magnitude (reused buffer —
  // copy it if the caller needs to keep values past the next process() call).
  process(frame) {
    const { size, window, re, im, magnitude } = this;
    for (let i = 0; i < size; i++) { re[i] = frame[i] * window[i]; im[i] = 0; }
    fft(re, im);
    magnitudeSpectrum(re, im, magnitude);
    return magnitude;
  }
}
