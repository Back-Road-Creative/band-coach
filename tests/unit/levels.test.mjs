import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noiseFloor, gatesFor, meterLevel, DEFAULT_GATES, releaseFloor } from '../../src/audio/levels.js';

// ---------- noiseFloor ----------

test('noiseFloor of an empty or invalid input is 0', () => {
  assert.equal(noiseFloor([]), 0);
  assert.equal(noiseFloor(undefined), 0);
  assert.equal(noiseFloor(null), 0);
});

test('noiseFloor is the median of a quiet, steady signal', () => {
  const samples = [0.001, 0.0012, 0.0011, 0.0013, 0.0009];
  const floor = noiseFloor(samples);
  assert.ok(floor >= 0.0009 && floor <= 0.0013, `expected a middle value, got ${floor}`);
});

test('noiseFloor ignores a cough or other stray loud outlier', () => {
  const quiet = new Array(20).fill(0.001);
  const withCough = [...quiet, 0.5]; // one loud spike
  const floor = noiseFloor(withCough);
  assert.ok(floor < 0.002, `a single cough should not move the floor much, got ${floor}`);
});

test('noiseFloor filters non-finite and negative garbage', () => {
  const floor = noiseFloor([0.001, NaN, -1, Infinity, 0.0012, undefined]);
  assert.ok(Number.isFinite(floor));
  assert.ok(floor > 0 && floor < 0.01);
});

// ---------- gatesFor ----------

test('gatesFor defaults to EXACTLY today\'s constants when no calibration exists', () => {
  assert.deepEqual(gatesFor(null), DEFAULT_GATES);
  assert.deepEqual(gatesFor(undefined), DEFAULT_GATES);
  assert.deepEqual(gatesFor(NaN), DEFAULT_GATES);
  assert.deepEqual(gatesFor(0), DEFAULT_GATES);
  assert.deepEqual(gatesFor(-1), DEFAULT_GATES);
});

test('gatesFor preserves default gate ratios', () => {
  const g = DEFAULT_GATES;
  assert.ok(Math.abs(g.note / g.pitch - 1.25) < 1e-9);
  assert.ok(Math.abs(g.chord / g.pitch - 1.5) < 1e-9);
});

test('gatesFor scales up for a noisy measured floor, down for a quiet one, keeping ratios', () => {
  const quiet = gatesFor(0.002);
  const noisy = gatesFor(0.02);
  assert.ok(quiet.pitch < noisy.pitch, 'a noisier floor should raise the gate');
  for (const g of [quiet, noisy]) {
    assert.ok(Math.abs(g.note / g.pitch - 1.25) < 1e-9);
    assert.ok(Math.abs(g.chord / g.pitch - 1.5) < 1e-9);
  }
});

test('gatesFor clamps an extremely quiet measured floor (silent interface) to the low clamp', () => {
  const atFloor = gatesFor(0.0001);
  const atMin = gatesFor(0.0015); // MIN_FLOOR
  assert.deepEqual(atFloor, atMin, 'below MIN_FLOOR should clamp to the same result as MIN_FLOOR itself');
});

test('gatesFor clamps an extremely noisy measured floor (noisy laptop mic) to the high clamp', () => {
  const wayNoisy = gatesFor(1);
  const atMax = gatesFor(0.03); // MAX_FLOOR
  assert.deepEqual(wayNoisy, atMax, 'above MAX_FLOOR should clamp to the same result as MAX_FLOOR itself');
});

test('gatesFor is monotonic non-decreasing between the clamps', () => {
  const a = gatesFor(0.002);
  const b = gatesFor(0.01);
  const c = gatesFor(0.025);
  assert.ok(a.pitch <= b.pitch);
  assert.ok(b.pitch <= c.pitch);
});

// ---------- meterLevel ----------

test('meterLevel of silence or invalid input is 0', () => {
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(-1), 0);
  assert.equal(meterLevel(NaN), 0);
  assert.equal(meterLevel(undefined), 0);
});

test('meterLevel is between 0 and 1 for any positive rms, clamped at both ends', () => {
  assert.equal(meterLevel(1e-9), 0, 'far below the meter floor clamps to 0');
  assert.equal(meterLevel(10), 1, 'far above the meter ceiling clamps to 1');
  const mid = meterLevel(0.05);
  assert.ok(mid > 0 && mid < 1);
});

test('meterLevel increases monotonically with rms', () => {
  const a = meterLevel(0.002);
  const b = meterLevel(0.02);
  const c = meterLevel(0.2);
  assert.ok(a < b);
  assert.ok(b < c);
});

// ---------- releaseFloor (VERIFIED DEFECT 2: src/app.js:650's hard-coded
// 0.006 release RMS ignored the calibrated gates entirely) ----------

test('releaseFloor is 0.75 x the default pitch gate (0.003) at the uncalibrated default gates', () => {
  assert.ok(Math.abs(releaseFloor(DEFAULT_GATES) - 0.003) < 1e-12);
});

test('releaseFloor scales with a calibrated pitch gate, keeping the same ratio', () => {
  const quiet = gatesFor(0.002); // a quiet room: a low gate
  const noisy = gatesFor(0.02); // a noisy mic/room raises it
  assert.ok(Math.abs(releaseFloor(quiet) / quiet.pitch - 0.75) < 1e-9);
  assert.ok(Math.abs(releaseFloor(noisy) / noisy.pitch - 0.75) < 1e-9);
  assert.ok(releaseFloor(quiet) < releaseFloor(noisy), 'a quiet mic must get a LOWER release floor than a noisy room');
  assert.ok(releaseFloor(noisy) > 0.006, 'a noisy room must get a HIGHER release floor than the old hard-coded constant');
});

test('releaseFloor falls back to the default pitch gate on a missing/malformed gates object', () => {
  assert.ok(Math.abs(releaseFloor(null) - 0.003) < 1e-12);
  assert.ok(Math.abs(releaseFloor(undefined) - 0.003) < 1e-12);
  assert.ok(Math.abs(releaseFloor({}) - 0.003) < 1e-12);
  assert.ok(Math.abs(releaseFloor({ pitch: NaN }) - 0.003) < 1e-12);
});

test('DEFAULT_GATES sit at the quiet-room floor and keep the 1 : 1.25 : 1.5 ratio', () => {
  assert.deepEqual({ ...DEFAULT_GATES }, { pitch: 0.004, note: 0.005, chord: 0.006 });
  assert.ok(Math.abs(gatesFor(0.0015).pitch - 0.0045) < 1e-9, 'a measured quiet room still yields 0.0045');
});
