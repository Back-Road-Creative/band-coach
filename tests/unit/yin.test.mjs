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

test('yin takes the calibrated quiet-room gate, defaulting to the original 0.008', () => {
  const sr = 44100, buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.02 * Math.sin(2 * Math.PI * 220 * i / sr); // rms ~0.014
  assert.ok(yin(buf, sr, 60, 1600).freq > 0, 'heard at the default gate');
  assert.equal(yin(buf, sr, 60, 1600, 0.03).freq, 0, 'a noisy room raises the gate above this note');
});

// The frameSize bug: yin's own lag search is capped at (buf.length >> 1) - 1
// samples (src/audio/yin.js), so a low fundamental whose period is longer
// than that cap can never be found. src/audio/pitch-worklet.js used to
// hardcode every instrument to a 2048-sample frame regardless of how low it
// plays. bass.js's open E (41.2 Hz, MIDI 28, ~1165-sample period at 48kHz)
// needs more than 2048 gives it (a 1023-sample cap); the frame size
// src/audio/range.js's frameSizeForInstrument now derives for the 4-string
// bass, 4096, resolves it cleanly.
const SAMPLE_RATE_48K = 48000;

test('a 4-string bass open E (41.2 Hz) is NOT reliably found at the old fixed frameSize 2048', () => {
  const buf = sine(41.2, 2048, SAMPLE_RATE_48K);
  const r = yin(buf, SAMPLE_RATE_48K, 25, 1500);
  // Either no lock at all, or a lock so far off it reads as a different
  // note (wrong-octave/harmonic confusion) -- either way, not the real 41.2Hz.
  const cents = r.freq ? 1200 * Math.log2(r.freq / 41.2) : null;
  const misdetected = !r.freq || Math.abs(cents) > 50;
  assert.ok(misdetected, `expected 2048 to fail on 41.2Hz, got freq ${r.freq}`);
});

test('a 4-string bass open E (41.2 Hz) IS found within a few cents at the derived frameSize 4096', () => {
  const buf = sine(41.2, 4096, SAMPLE_RATE_48K);
  const r = yin(buf, SAMPLE_RATE_48K, 25, 1500);
  assert.ok(r.freq > 0, 'a clean 41.2Hz tone should be detected at frameSize 4096');
  const cents = 1200 * Math.log2(r.freq / 41.2);
  assert.ok(Math.abs(cents) < 10, `expected within 10 cents of 41.2Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
});

test('a 5-string bass open B0 (30.87 Hz) is NOT found at all at the old fixed frameSize 2048', () => {
  const buf = sine(30.87, 2048, SAMPLE_RATE_48K);
  const r = yin(buf, SAMPLE_RATE_48K, 20, 1500);
  assert.equal(r.freq, 0, 'B0 should not lock at all at frameSize 2048');
});

test('a 5-string bass open B0 (30.87 Hz) IS found within a few cents at the derived frameSize 4096', () => {
  const buf = sine(30.87, 4096, SAMPLE_RATE_48K);
  const r = yin(buf, SAMPLE_RATE_48K, 20, 1500);
  assert.ok(r.freq > 0, 'B0 should lock at frameSize 4096');
  const cents = 1200 * Math.log2(r.freq / 30.87);
  assert.ok(Math.abs(cents) < 10, `expected within 10 cents of 30.87Hz, got ${r.freq}Hz (${cents.toFixed(1)} cents)`);
});
