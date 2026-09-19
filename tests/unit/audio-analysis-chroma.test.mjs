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

function maxPc(chroma) {
  let m = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[m]) m = i;
  return m;
}

test('chromaFromSpectrum puts energy in the right pitch class for A4=440', () => {
  assert.equal(maxPc(chromaFromSpectrum(spectrumForFreq(440, SR, 4096), SR, 4096)), 9);
});

test('chromaFromSpectrum follows a tuning offset when given a4', () => {
  const a4 = 440 * Math.pow(2, 30 / 1200);
  const mag = spectrumForFreq(midiToFreq(69, a4), SR, 4096);
  assert.equal(maxPc(chromaFromSpectrum(mag, SR, 4096, { a4 })), 9);
});

test('estimateTuningCents recovers a known offset', () => {
  const cents = 30, a4 = 440 * Math.pow(2, cents / 1200);
  const frames = [0, 4, 7, 9].map((pc) => spectrumForFreq(midiToFreq(60 + pc, a4), SR, 4096));
  assert.ok(Math.abs(estimateTuningCents(frames, SR, 4096) - cents) < 5);
});

test('chromaDistance is zero for identical vectors and positive otherwise', () => {
  const a = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(chromaDistance(a, a), 0);
  assert.ok(chromaDistance(a, b) > 0);
});

test('beatSynchronousChroma averages frames within each beat window', () => {
  const frameTimes = [0, 0.1, 0.2, 0.3, 0.4];
  const A = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], B = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const chromaFrames = [A, A, B, B, B];
  const avg = beatSynchronousChroma(chromaFrames, frameTimes, [0, 0.2]);
  assert.equal(avg.length, 2);
  assert.deepEqual(Array.from(avg[0]), A);
  assert.deepEqual(Array.from(avg[1]), B);
});
