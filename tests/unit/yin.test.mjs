// Pure extraction of the YIN pitch estimator, unchanged from its original
// inline form in src/app.js (E3: it used to live only on the main thread,
// re-allocating buffers in a setInterval loop). This is now the single
// implementation shared by the main thread and the AudioWorklet processor
// string built in src/audio/pitch-worklet.js — see that module's test for
// the drift check (it asserts the worklet source embeds this exact
// function's own source text via Function.prototype.toString()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin } from '../../src/audio/yin.js';

const SAMPLE_RATE = 44100;

function sine(freq, n, sampleRate, amplitude = 0.5) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return buf;
}

test('yin finds the fundamental of a clean sine within a few cents', () => {
  const freq = 220;
  const buf = sine(freq, 2048, SAMPLE_RATE);
  const r = yin(buf, SAMPLE_RATE, 60, 1200);
  assert.ok(r.freq > 0, 'a clean tone should be detected');
  const cents = 1200 * Math.log2(r.freq / freq);
  assert.ok(Math.abs(cents) < 10, `expected within 10 cents of ${freq}Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
});

test('yin reports rms below 0.008 as silence (freq 0)', () => {
  const buf = new Float32Array(2048); // exact silence
  const r = yin(buf, SAMPLE_RATE, 60, 1200);
  assert.equal(r.freq, 0);
});

test('yin returns a clarity score for a periodic signal', () => {
  const buf = sine(440, 2048, SAMPLE_RATE);
  const r = yin(buf, SAMPLE_RATE, 60, 1200);
  assert.ok(r.clarity > 0.8, `expected high clarity for a clean sine, got ${r.clarity}`);
});
