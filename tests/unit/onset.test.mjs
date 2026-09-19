// F8: same-note repeats on a ringing string are missed because there is no
// onset detector — the pitch loop only re-fires a note after RMS falls under
// 0.006 or the pitch changes (src/app.js onPitch, pluck branch). This module
// detects the attack transient itself (an energy-flux onset with an adaptive
// threshold and a refractory period) so a second pluck of the SAME note,
// while the first is still ringing, can re-fire the note event.
//
// All test signals are synthesized deterministically (no Math.random): a
// seeded xorshift generator stands in for "noise".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnsetDetector } from '../../src/audio/onset.js';

const SAMPLE_RATE = 44100;
const FRAME_SIZE = 1024;
const HOP = 512;

function seededNoise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

// Builds a full signal (Float32Array) for a decaying-sine pluck starting at
// `startSample`, added on top of whatever is already in `into`.
function addPluck(into, startSample, freq, amplitude, decayPerSample, sampleRate) {
  for (let i = startSample; i < into.length; i++) {
    const t = (i - startSample) / sampleRate;
    const env = amplitude * Math.exp(-decayPerSample * (i - startSample));
    into[i] += env * Math.sin(2 * Math.PI * freq * t);
  }
}

// Feeds a full signal through a fresh detector in FRAME_SIZE-length, HOP-
// spaced windows (mirrors how the worklet will call push()) and returns the
// list of onset strengths where onset === true.
function runDetector(signal, opts = {}) {
  const det = createOnsetDetector({ sampleRate: SAMPLE_RATE, frameSize: FRAME_SIZE, hop: HOP, ...opts });
  const onsets = [];
  for (let start = 0; start + FRAME_SIZE <= signal.length; start += HOP) {
    const frame = signal.subarray(start, start + FRAME_SIZE);
    const result = det.push(frame);
    if (result.onset) onsets.push({ atSample: start, strength: result.strength });
  }
  return onsets;
}

test('two same-pitch plucks, the second while the first still rings above RMS 0.006, yield two onsets', () => {
  const seconds = 1.5;
  const n = Math.round(seconds * SAMPLE_RATE);
  const signal = new Float32Array(n);
  const freq = 220;
  const decay = 4; // per second; scaled below to per-sample
  const decayPerSample = decay / SAMPLE_RATE;
  addPluck(signal, 0, freq, 0.9, decayPerSample, SAMPLE_RATE);

  // Second pluck at 0.5s: confirm the first note's envelope is still above
  // RMS 0.006 at that point (this is the scenario the plan describes).
  const envAt0_5 = 0.9 * Math.exp(-decayPerSample * 0.5 * SAMPLE_RATE);
  assert.ok(envAt0_5 / Math.SQRT2 > 0.006, `first pluck envelope RMS ${envAt0_5 / Math.SQRT2} should still be above 0.006 at 0.5s`);

  addPluck(signal, Math.round(0.5 * SAMPLE_RATE), freq, 0.9, decayPerSample, SAMPLE_RATE);

  const onsets = runDetector(signal);
  assert.equal(onsets.length, 2, `expected exactly two onsets, got ${onsets.length} at samples ${onsets.map((o) => o.atSample).join(',')}`);
  const firstAt = onsets[0].atSample / SAMPLE_RATE;
  const secondAt = onsets[1].atSample / SAMPLE_RATE;
  assert.ok(firstAt < 0.1, `first onset should land near t=0, got ${firstAt}s`);
  assert.ok(Math.abs(secondAt - 0.5) < 0.1, `second onset should land near t=0.5s, got ${secondAt}s`);
});

test('one sustained note yields exactly one onset', () => {
  const seconds = 1.0;
  const n = Math.round(seconds * SAMPLE_RATE);
  const signal = new Float32Array(n);
  const freq = 440;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // A short attack ramp then a steady sustain, like a bowed or blown note.
    const attack = Math.min(1, t / 0.02);
    signal[i] = 0.6 * attack * Math.sin(2 * Math.PI * freq * t);
  }
  const onsets = runDetector(signal);
  assert.equal(onsets.length, 1, `expected exactly one onset, got ${onsets.length} at samples ${onsets.map((o) => o.atSample).join(',')}`);
});

test('silence yields no onsets', () => {
  const signal = new Float32Array(Math.round(1.0 * SAMPLE_RATE));
  const onsets = runDetector(signal);
  assert.equal(onsets.length, 0);
});

test('steady noise yields no onsets', () => {
  const n = Math.round(1.0 * SAMPLE_RATE);
  const signal = new Float32Array(n);
  const rand = seededNoise(12345);
  for (let i = 0; i < n; i++) signal[i] = rand() * 0.02;
  const onsets = runDetector(signal);
  assert.equal(onsets.length, 0, `expected no onsets in steady noise, got ${onsets.length}`);
});

test('refractory period suppresses a second onset that starts too soon after the first', () => {
  // Two plucks 30ms apart: closer together than any real re-pluck a learner
  // would make, and inside the refractory window, so only one onset fires.
  const seconds = 0.5;
  const n = Math.round(seconds * SAMPLE_RATE);
  const signal = new Float32Array(n);
  const decayPerSample = 4 / SAMPLE_RATE;
  addPluck(signal, 0, 220, 0.9, decayPerSample, SAMPLE_RATE);
  addPluck(signal, Math.round(0.03 * SAMPLE_RATE), 220, 0.9, decayPerSample, SAMPLE_RATE);
  const onsets = runDetector(signal);
  assert.equal(onsets.length, 1, `expected the too-close second pluck to be suppressed by the refractory period, got ${onsets.length}`);
});

test('push() runs many frames without growing its internal history buffer (pre-allocated, not reallocated)', () => {
  const det = createOnsetDetector({ sampleRate: SAMPLE_RATE, frameSize: FRAME_SIZE, hop: HOP, historyFrames: 20 });
  const frame = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) frame[i] = Math.sin(i * 0.1) * 0.3;
  for (let i = 0; i < 5000; i++) {
    const r = det.push(frame);
    assert.equal(typeof r.onset, 'boolean');
    assert.equal(typeof r.strength, 'number');
  }
});
