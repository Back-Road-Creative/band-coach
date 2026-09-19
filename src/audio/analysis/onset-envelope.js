// Wiring: computeOnsetEnvelope(pcm, sampleRate, opts) takes mono Float32Array PCM (decoding
// happens elsewhere) and returns { envelope: Float32Array, hopSeconds }. Feed straight into
// tempo.js's estimateTempo/trackBeats.

import { FFTProcessor } from './fft.js';

const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 512;

// Log-magnitude spectral-flux novelty curve: for each hop, sum of positive frame-to-frame
// increases in log(1+magnitude) across frequency bins (Dixon 2006 / Ellis 2007 style
// rectified spectral flux).
export function computeOnsetEnvelope(pcm, sampleRate, opts = {}) {
  const frameSize = opts.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = opts.hopSize ?? DEFAULT_HOP_SIZE;
  if (!(frameSize > 0) || (frameSize & (frameSize - 1)) !== 0) {
    throw new Error('computeOnsetEnvelope: frameSize must be a power of two');
  }
  const numFrames = pcm.length >= frameSize ? Math.floor((pcm.length - frameSize) / hopSize) + 1 : 0;
  const envelope = new Float32Array(numFrames);
  const hopSeconds = hopSize / sampleRate;
  const proc = new FFTProcessor(frameSize);
  const numBins = frameSize / 2 + 1;
  const prevLogMag = new Float64Array(numBins);
  const frame = new Float32Array(frameSize);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    frame.set(pcm.subarray(start, start + frameSize));
    const mag = proc.process(frame);
    let flux = 0;
    for (let i = 0; i < numBins; i++) {
      const logMag = Math.log1p(mag[i]);
      const diff = logMag - prevLogMag[i];
      if (diff > 0) flux += diff;
      prevLogMag[i] = logMag;
    }
    envelope[f] = flux;
  }
  return { envelope, hopSeconds };
}
