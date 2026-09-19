import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, hannWindow, magnitudeSpectrum, FFTProcessor } from '../../src/audio/analysis/fft.js';

function naiveDft(reIn, imIn) {
  const n = reIn.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n, c = Math.cos(ang), s = Math.sin(ang);
      sr += reIn[t] * c - imIn[t] * s;
      si += reIn[t] * s + imIn[t] * c;
    }
    re[k] = sr; im[k] = si;
  }
  return { re, im };
}

for (const [n, gen] of [
  [8, (i) => [0.2, -0.5, 0.9, 0.1, -0.3, 0.7, -0.9, 0.4][i]],
  [16, (i) => Math.sin(i) * 0.5 + 0.1 * i],
]) {
  test(`fft matches naive DFT for N=${n}`, () => {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = gen(i);
    const expected = naiveDft(re.slice(), new Float64Array(n));
    fft(re, im);
    for (let i = 0; i < n; i++) {
      assert.ok(Math.abs(re[i] - expected.re[i]) < 1e-8, `re[${i}]`);
      assert.ok(Math.abs(im[i] - expected.im[i]) < 1e-8, `im[${i}]`);
    }
  });
}

test('fft of pure sinusoid peaks at expected bin', () => {
  const n = 64, bin = 5;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
  fft(re, im);
  const mag = new Float64Array(n / 2 + 1);
  magnitudeSpectrum(re, im, mag);
  let peakBin = 0, peakVal = -Infinity;
  for (let i = 0; i < mag.length; i++) if (mag[i] > peakVal) { peakVal = mag[i]; peakBin = i; }
  assert.equal(peakBin, bin);
});

test('hannWindow has near-zero endpoints and peak ~1 at centre', () => {
  const w = hannWindow(8);
  assert.equal(w.length, 8);
  assert.ok(w[0] < 1e-9);
  assert.ok(Math.max(...w) > 0.9 && Math.max(...w) <= 1.0001);
});

test('FFTProcessor reuses its magnitude buffer across calls', () => {
  const proc = new FFTProcessor(32);
  const mag1 = proc.process(new Float32Array(32).fill(0.1));
  assert.equal(mag1.length, 17);
  const mag2 = proc.process(new Float32Array(32).fill(0.3));
  assert.equal(mag2, proc.magnitude);
});
