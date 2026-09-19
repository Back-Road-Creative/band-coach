import test from 'node:test';
import assert from 'node:assert/strict';
import { FFTProcessor } from '../../src/audio/analysis/fft.js';
import { chromaFromSpectrum, estimateTuningCents, beatSynchronousChroma, chromaDistance } from '../../src/audio/analysis/chroma.js';
import { SR, midiToFreq } from './audio-analysis-fixtures.mjs';

function spectrumForFreq(freq, sr, size) {
  const proc = new FFTProcessor(size);
  const frame = new Float32Array(size);
  for (let i = 0; i < size; i++) frame[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return proc.process(frame);
}

test('chromaFromSpectrum puts energy in the right pitch class for A4=440', () => {
  const size = 4096;
  const mag = spectrumForFreq(440, SR, size); // A -> pitch class 9
  const chroma = chromaFromSpectrum(mag, SR, size);
  let maxPc = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[maxPc]) maxPc = i;
  assert.equal(maxPc, 9);
});

test('chromaFromSpectrum follows a tuning offset when given a4', () => {
  const size = 4096;
  const a4 = 440 * Math.pow(2, 30 / 1200); // +30 cents sharp
  const freq = midiToFreq(69, a4); // "A" but sharp
  const mag = spectrumForFreq(freq, SR, size);
  const chromaDefault = chromaFromSpectrum(mag, SR, size, { a4: 440 });
  const chromaTuned = chromaFromSpectrum(mag, SR, size, { a4 });
  let maxDefault = 0, maxTuned = 0;
  for (let i = 1; i < 12; i++) {
    if (chromaDefault[i] > chromaDefault[maxDefault]) maxDefault = i;
    if (chromaTuned[i] > chromaTuned[maxTuned]) maxTuned = i;
  }
  assert.equal(maxTuned, 9);
});

test('estimateTuningCents recovers a known offset', () => {
  const size = 4096;
  const centsOffset = 30;
  const a4 = 440 * Math.pow(2, centsOffset / 1200);
  const frames = [];
  for (const pc of [0, 4, 7, 9]) {
    const freq = midiToFreq(60 + pc, a4);
    frames.push(spectrumForFreq(freq, SR, size));
  }
  const est = estimateTuningCents(frames, SR, size);
  assert.ok(Math.abs(est - centsOffset) < 5, `expected ~${centsOffset}c, got ${est}`);
});

test('chromaDistance is zero for identical vectors and positive otherwise', () => {
  const a = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(chromaDistance(a, a), 0);
  assert.ok(chromaDistance(a, b) > 0);
});

test('beatSynchronousChroma averages frames within each beat window', () => {
  const frameTimes = [0, 0.1, 0.2, 0.3, 0.4];
  const chromaFrames = [
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const beats = [0, 0.2];
  const avg = beatSynchronousChroma(chromaFrames, frameTimes, beats);
  assert.equal(avg.length, 2);
  assert.deepEqual(Array.from(avg[0]), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(avg[1]), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
