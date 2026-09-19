// Item 4 (Wave W, unit w-fixes): the pitch worklet is created once with a
// fixed fmin/fmax (36/1600 in src/app.js's ensurePitchWorklet), unlike the
// old main-thread listen() path which read each module's own M.fmin/M.fmax
// every call. src/audio/pitch-worklet.js's AudioWorkletProcessor had no
// `port.onmessage` handler at all, so there was no way to hand it a new
// range after creation.
//
// applyRangeMessage is the (self-contained, no free variables) function
// whose source text is embedded into the worklet string via toString() --
// same pattern yin() and createOnsetDetector() already use -- so testing it
// directly here proves the exact code path the worklet runs on receiving a
// { type: 'range', fmin, fmax } message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRangeMessage, PITCH_WORKLET_SOURCE } from '../../src/audio/pitch-worklet.js';

test('applyRangeMessage updates fmin/fmax from a range message', () => {
  const proc = { fmin: 36, fmax: 1600 };
  applyRangeMessage(proc, { type: 'range', fmin: 200, fmax: 2300 });
  assert.equal(proc.fmin, 200);
  assert.equal(proc.fmax, 2300);
});

test('applyRangeMessage ignores messages of another type', () => {
  const proc = { fmin: 36, fmax: 1600 };
  applyRangeMessage(proc, { type: 'onset', fmin: 999 });
  assert.equal(proc.fmin, 36);
  assert.equal(proc.fmax, 1600);
});

test('applyRangeMessage ignores non-finite or missing values', () => {
  const proc = { fmin: 36, fmax: 1600 };
  applyRangeMessage(proc, { type: 'range', fmin: NaN, fmax: undefined });
  assert.equal(proc.fmin, 36);
  assert.equal(proc.fmax, 1600);
  applyRangeMessage(proc, { type: 'range' });
  assert.equal(proc.fmin, 36);
  assert.equal(proc.fmax, 1600);
});

test('the worklet processor source wires port.onmessage through applyRangeMessage', () => {
  assert.match(PITCH_WORKLET_SOURCE, /this\.port\.onmessage\s*=/, 'processor must install a port.onmessage handler');
  assert.match(PITCH_WORKLET_SOURCE, /applyRangeMessage\(this, ev\.data\)/, 'processor must delegate to applyRangeMessage');
});
