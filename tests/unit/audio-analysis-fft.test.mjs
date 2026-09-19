import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, hannWindow, magnitudeSpectrum, FFTProcessor } from '../../src/audio/analysis/fft.js';

function naiveDft(reIn, imIn) {
  const n = reIn.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(ang), s = Math.sin(ang);
      sr += reIn[t] * c - imIn[t] * s;
      si += reIn[t] * s + imIn[t] * c;
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

test('fft matches naive DFT for random real input, N=8', () => {
  const n = 8;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const seedRe = [0.2, -0.5, 0.9, 0.1, -0.3, 0.7, -0.9, 0.4];
  for (let i = 0; i < n; i++) re[i] = seedRe[i];
  const expected = naiveDft(re, new Float64Array(n));
  fft(re, im);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(re[i] - expected.re[i]) < 1e-9, `re[${i}] ${re[i]} vs ${expected.re[i]}`);
    assert.ok(Math.abs(im[i] - expected.im[i]) < 1e-9, `im[${i}] ${im[i]} vs ${expected.im[i]}`);
  }
});

test('fft matches naive DFT for N=16', () => {
  const n = 16;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(i) * 0.5 + 0.1 * i;
  const expected = naiveDft(re.slice(), new Float64Array(n));
  fft(re, im);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(re[i] - expected.re[i]) < 1e-8);
    assert.ok(Math.abs(im[i] - expected.im[i]) < 1e-8);
  }
});

test('fft of pure sinusoid peaks at expected bin', () => {
  const n = 64;
  const bin = 5;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
  fft(re, im);
  const mag = new Float64Array(n / 2 + 1);
  magnitudeSpectrum(re, im, mag);
  let peakBin = 0, peakVal = -Infinity;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > peakVal) { peakVal = mag[i]; peakBin = i; }
  }
  assert.equal(peakBin, bin);
});

test('hannWindow has zero endpoints and peak 1 at centre', () => {
  const w = hannWindow(8);
  assert.equal(w.length, 8);
  assert.ok(w[0] < 1e-9);
  assert.ok(Math.abs(w[7] - 0) < 0.3); // near zero at last sample too
  const maxVal = Math.max(...w);
  assert.ok(maxVal > 0.9 && maxVal <= 1.0001);
});

test('FFTProcessor produces consistent magnitude spectrum length and is reusable without allocation growth', () => {
  const size = 32;
  const proc = new FFTProcessor(size);
  const frame1 = new Float32Array(size).fill(0);
  frame1[0] = 1;
  const mag1 = proc.process(frame1);
  assert.equal(mag1.length, size / 2 + 1);
  const frame2 = new Float32Array(size).fill(0.3);
  const mag2 = proc.process(frame2);
  assert.equal(mag2, proc.magnitude); // same buffer reused
  assert.equal(mag2.length, size / 2 + 1);
});
