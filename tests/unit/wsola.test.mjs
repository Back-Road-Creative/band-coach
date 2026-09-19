import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStretcher, stretch, processorSource } from '../../src/audio/stretch/wsola.js';

const SR = 44100;

function makeSine(freq, seconds, sampleRate) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

// Interpolated positive-going zero-crossing frequency estimate. Skips a
// margin at each end to avoid WSOLA start/flush transients.
function measureFrequency(signal, sampleRate, marginSamples) {
  const margin = marginSamples || 2048;
  const start = Math.min(margin, Math.floor(signal.length / 4));
  const end = Math.max(start + 1, signal.length - margin);
  const crossings = [];
  for (let i = start + 1; i < end; i++) {
    const a = signal[i - 1];
    const b = signal[i];
    if (a <= 0 && b > 0) {
      crossings.push(i - 1 + (0 - a) / (b - a));
    }
  }
  if (crossings.length < 3) return NaN;
  const n = crossings.length - 1;
  const totalSamples = crossings[crossings.length - 1] - crossings[0];
  return (sampleRate * n) / totalSamples;
}

function centsDiff(measured, expected) {
  return 1200 * Math.log2(measured / expected);
}

function makeClickTrain(intervalSec, count, sampleRate, leadInSec) {
  const leadIn = leadInSec != null ? leadInSec : intervalSec;
  const n = Math.round((leadIn + intervalSec * count + intervalSec) * sampleRate);
  const out = new Float32Array(n);
  const times = [];
  for (let k = 0; k < count; k++) {
    const t = leadIn + k * intervalSec;
    const idx = Math.round(t * sampleRate);
    if (idx < out.length) {
      out[idx] = 1;
      times.push(t);
    }
  }
  return { pcm: out, times };
}

// Groups blobs of energy (a click may be smeared across a Hann window's
// worth of samples, or briefly duplicated, by WSOLA's overlap re-reads) and
// returns each blob's energy-weighted centroid time.
function detectClickTimes(signal, sampleRate, threshold) {
  const times = [];
  let i = 0;
  const n = signal.length;
  while (i < n) {
    if (Math.abs(signal[i]) > threshold) {
      let j = i;
      let lastAbove = i;
      let weightedSum = 0;
      let weightTotal = 0;
      while (j < n && j - lastAbove < 400) {
        const a = Math.abs(signal[j]);
        if (a > threshold * 0.05) {
          weightedSum += j * a;
          weightTotal += a;
          lastAbove = j;
        }
        j++;
      }
      times.push(weightedSum / weightTotal / sampleRate);
      i = lastAbove + 1;
    } else {
      i++;
    }
  }
  return times;
}

test('440 Hz sine stretched to 0.5x keeps pitch within 5 cents and roughly doubles length', () => {
  const input = makeSine(440, 2, SR);
  const out = stretch(input, 0.5, { sampleRate: SR });
  const expectedLen = Math.round(input.length / 0.5);
  assert.ok(Math.abs(out.length - expectedLen) <= 512, `length ${out.length} vs expected ${expectedLen}`);
  const f = measureFrequency(out, SR);
  assert.ok(Math.abs(centsDiff(f, 440)) < 5, `measured ${f}Hz, ${centsDiff(f, 440)} cents off`);
});

test('440 Hz sine stretched to 0.75x keeps pitch within 5 cents', () => {
  const input = makeSine(440, 2, SR);
  const out = stretch(input, 0.75, { sampleRate: SR });
  const expectedLen = Math.round(input.length / 0.75);
  assert.ok(Math.abs(out.length - expectedLen) <= 512, `length ${out.length} vs expected ${expectedLen}`);
  const f = measureFrequency(out, SR);
  assert.ok(Math.abs(centsDiff(f, 440)) < 5, `measured ${f}Hz, ${centsDiff(f, 440)} cents off`);
});

test('440 Hz sine sped up to 1.25x keeps pitch within 5 cents', () => {
  const input = makeSine(440, 2, SR);
  const out = stretch(input, 1.25, { sampleRate: SR });
  const expectedLen = Math.round(input.length / 1.25);
  assert.ok(Math.abs(out.length - expectedLen) <= 512, `length ${out.length} vs expected ${expectedLen}`);
  const f = measureFrequency(out, SR);
  assert.ok(Math.abs(centsDiff(f, 440)) < 5, `measured ${f}Hz, ${centsDiff(f, 440)} cents off`);
});

test('rate 1.0 is near-identity (high SNR against the original)', () => {
  const input = makeSine(440, 1, SR);
  const out = stretch(input, 1.0, { sampleRate: SR });
  const n = Math.min(input.length, out.length);
  // Compare a stable middle window (skip the first/last blocks where the
  // OLA ramp-up/flush tail has no full-strength counterpart yet).
  const margin = 4096;
  let signal = 0;
  let noise = 0;
  for (let i = margin; i < n - margin; i++) {
    signal += input[i] * input[i];
    const e = out[i] - input[i];
    noise += e * e;
  }
  const snrDb = 10 * Math.log10(signal / Math.max(noise, 1e-12));
  assert.ok(snrDb > 30, `SNR only ${snrDb} dB`);
});

test('click train count and spacing scale by 1/rate within 5ms', () => {
  const rate = 0.75;
  const { pcm, times } = makeClickTrain(0.25, 8, SR, 0.25);
  const out = stretch(pcm, rate, { sampleRate: SR });
  const detected = detectClickTimes(out, SR, 0.2);

  assert.ok(Math.abs(detected.length - times.length) <= 1, `detected ${detected.length} clicks, expected ~${times.length}`);

  const expectedInterval = 0.25 / rate;
  const gaps = [];
  for (let i = 1; i < detected.length; i++) gaps.push(detected[i] - detected[i - 1]);
  for (const g of gaps) {
    assert.ok(Math.abs(g - expectedInterval) < 0.005, `gap ${g}s vs expected ${expectedInterval}s`);
  }
});

test('streaming in odd chunk sizes equals one-shot output', () => {
  const input = makeSine(330, 1, SR);
  const rate = 0.6;

  const oneShotEngine = createStretcher({ sampleRate: SR, channels: 1, rate });
  const oneShotHead = oneShotEngine.process(input);
  const oneShotTail = oneShotEngine.flush();
  const oneShot = new Float32Array(oneShotHead.length + oneShotTail.length);
  oneShot.set(oneShotHead, 0);
  oneShot.set(oneShotTail, oneShotHead.length);

  const streamEngine = createStretcher({ sampleRate: SR, channels: 1, rate });
  const chunkSizes = [37, 101, 977, 333, 1, 4001, 199];
  let pos = 0;
  let sizeIdx = 0;
  const pieces = [];
  while (pos < input.length) {
    const size = chunkSizes[sizeIdx % chunkSizes.length];
    sizeIdx++;
    const end = Math.min(pos + size, input.length);
    pieces.push(streamEngine.process(input.subarray(pos, end)));
    pos = end;
  }
  pieces.push(streamEngine.flush());
  let total = 0;
  for (const p of pieces) total += p.length;
  const streamed = new Float32Array(total);
  let off = 0;
  for (const p of pieces) {
    streamed.set(p, off);
    off += p.length;
  }

  assert.equal(streamed.length, oneShot.length);
  for (let i = 0; i < streamed.length; i++) {
    assert.equal(streamed[i], oneShot[i], `sample ${i} differs`);
  }
});

test('throughput: 10s of 44.1kHz mono stretches well under realtime', () => {
  const input = makeSine(220, 10, SR);
  const started = Date.now();
  const out = stretch(input, 0.6, { sampleRate: SR });
  const elapsedSec = (Date.now() - started) / 1000;
  const audioSec = input.length / SR;
  const realtimeFactor = audioSec / Math.max(elapsedSec, 1e-6);
  // eslint-disable-next-line no-console
  console.log(`wsola throughput: ${audioSec}s audio in ${elapsedSec}s (realtime factor ${realtimeFactor.toFixed(1)}x)`);
  assert.ok(out.length > 0);
  assert.ok(elapsedSec < audioSec, `took ${elapsedSec}s for ${audioSec}s of audio`);
});

test('processorSource evaluates to an engine identical to the module for the same input', async () => {
  const src = processorSource();
  assert.match(src, /function createStretcherEngine/);
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${src}\nreturn createStretcherEngine;`)();

  const input = makeSine(500, 0.5, SR);
  const rate = 0.8;

  const a = createStretcher({ sampleRate: SR, channels: 1, rate });
  const outA1 = a.process(input);
  const outA2 = a.flush();

  const b = factory({ sampleRate: SR, channels: 1, rate });
  const outB1 = b.process(input);
  const outB2 = b.flush();

  assert.equal(outA1.length, outB1.length);
  for (let i = 0; i < outA1.length; i++) assert.equal(outA1[i], outB1[i]);
  assert.equal(outA2.length, outB2.length);
  for (let i = 0; i < outA2.length; i++) assert.equal(outA2[i], outB2[i]);
});

test('setRate clamps to [0.5, 1.25]', () => {
  const engine = createStretcher({ sampleRate: SR, channels: 1, rate: 1 });
  assert.equal(engine.setRate(2), 1.25);
  assert.equal(engine.setRate(0.1), 0.5);
  assert.equal(engine.setRate(0.9), 0.9);
  assert.equal(engine.getRate(), 0.9);
});
