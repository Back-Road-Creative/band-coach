// VERIFIED DEFECT 1 (mic-gate-and-capture): ensurePitchWorklet() built the
// worklet once with `rmsGate: gates.pitch` captured at creation and cached
// the promise forever; calibrateNoiseFloor() recomputes `gates` on the main
// thread afterwards, but nothing ever told the already-created worklet.
// applyGateMessage is the { type: 'gate', rmsGate } port-message handler,
// same self-contained shape (source text embedded via toString()) as
// applyRangeMessage/applyFrameSizeMessage in src/audio/pitch-worklet.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGateMessage, PITCH_WORKLET_SOURCE } from '../../src/audio/pitch-worklet.js';

test('applyGateMessage updates rmsGate from a gate message', () => {
  const proc = { rmsGate: 0.008 };
  applyGateMessage(proc, { type: 'gate', rmsGate: 0.0045 });
  assert.equal(proc.rmsGate, 0.0045);
});

test('applyGateMessage ignores messages of another type', () => {
  const proc = { rmsGate: 0.008 };
  applyGateMessage(proc, { type: 'range', rmsGate: 0.02 });
  assert.equal(proc.rmsGate, 0.008);
});

test('applyGateMessage ignores non-finite, negative, or missing values', () => {
  const proc = { rmsGate: 0.008 };
  applyGateMessage(proc, { type: 'gate', rmsGate: NaN });
  assert.equal(proc.rmsGate, 0.008);
  applyGateMessage(proc, { type: 'gate', rmsGate: -0.01 });
  assert.equal(proc.rmsGate, 0.008);
  applyGateMessage(proc, { type: 'gate' });
  assert.equal(proc.rmsGate, 0.008);
});

test('applyGateMessage accepts an explicit zero gate (a maximally quiet/hot mic)', () => {
  const proc = { rmsGate: 0.008 };
  applyGateMessage(proc, { type: 'gate', rmsGate: 0 });
  assert.equal(proc.rmsGate, 0);
});

test('the worklet processor source wires port.onmessage through applyGateMessage', () => {
  assert.match(PITCH_WORKLET_SOURCE, /applyGateMessage\(this, ev\.data\)/, 'processor must delegate to applyGateMessage');
});
