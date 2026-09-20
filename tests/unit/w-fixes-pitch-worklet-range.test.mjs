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
import { applyRangeMessage, applyFrameSizeMessage, PITCH_WORKLET_SOURCE } from '../../src/audio/pitch-worklet.js';

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

// Bug: the worklet was created ONCE with a frameSize fixed for the whole
// session (opts.frameSize || 2048 in the constructor and in createPitchNode),
// unlike fmin/fmax which applyRangeMessage above lets a caller change after
// creation. A learner switching from guitar (frameSize 2048 is fine) to bass
// (needs 4096, see src/audio/range.js's frameSizeForInstrument) left the
// worklet stuck at whatever frameSize it was first created with.
// applyFrameSizeMessage is the { type: 'frameSize', frameSize } counterpart
// to applyRangeMessage: it reallocates the ring/linear buffers and the onset
// detector so the processor keeps running with a consistent frame after a
// resize, rather than reading/writing past a stale buffer length.
test('applyFrameSizeMessage reallocates the ring and linear buffers to the new frameSize', () => {
  const proc = { frameSize: 2048, hop: 512, sampleRate: 48000, ring: new Float32Array(2048), linear: new Float32Array(2048), writeIdx: 7, filled: 2048, sinceHop: 3 };
  applyFrameSizeMessage(proc, { type: 'frameSize', frameSize: 4096 });
  assert.equal(proc.frameSize, 4096);
  assert.equal(proc.ring.length, 4096);
  assert.equal(proc.linear.length, 4096);
  assert.equal(proc.writeIdx, 0, 'resize must reset the write cursor, not read a stale index into the new buffer');
  assert.equal(proc.filled, 0, 'resize must reset fill state -- the old samples do not carry over');
  assert.equal(proc.sinceHop, 0);
});

test('applyFrameSizeMessage rebuilds the onset detector at the new frame size', () => {
  const proc = { frameSize: 2048, hop: 512, sampleRate: 48000, ring: new Float32Array(2048), linear: new Float32Array(2048), writeIdx: 0, filled: 0, sinceHop: 0, detector: { push: () => ({ onset: false }) } };
  const before = proc.detector;
  applyFrameSizeMessage(proc, { type: 'frameSize', frameSize: 4096 });
  assert.notEqual(proc.detector, before, 'a detector sized for the old frame must not keep running against the new one');
  assert.equal(typeof proc.detector.push, 'function');
});

test('applyFrameSizeMessage ignores messages of another type', () => {
  const proc = { frameSize: 2048, hop: 512, sampleRate: 48000, ring: new Float32Array(2048), linear: new Float32Array(2048), writeIdx: 0, filled: 0, sinceHop: 0 };
  applyFrameSizeMessage(proc, { type: 'range', frameSize: 4096 });
  assert.equal(proc.frameSize, 2048);
  assert.equal(proc.ring.length, 2048);
});

test('applyFrameSizeMessage ignores a non-power-of-two or missing frameSize', () => {
  const proc = { frameSize: 2048, hop: 512, sampleRate: 48000, ring: new Float32Array(2048), linear: new Float32Array(2048), writeIdx: 0, filled: 0, sinceHop: 0 };
  applyFrameSizeMessage(proc, { type: 'frameSize', frameSize: 3000 });
  assert.equal(proc.frameSize, 2048);
  applyFrameSizeMessage(proc, { type: 'frameSize' });
  assert.equal(proc.frameSize, 2048);
});

test('applyFrameSizeMessage is a no-op when the frameSize is already current', () => {
  const proc = { frameSize: 2048, hop: 512, sampleRate: 48000, ring: new Float32Array(2048), linear: new Float32Array(2048), writeIdx: 9, filled: 2048, sinceHop: 4 };
  applyFrameSizeMessage(proc, { type: 'frameSize', frameSize: 2048 });
  assert.equal(proc.writeIdx, 9, 'no-op resize must not disturb in-flight state');
  assert.equal(proc.filled, 2048);
});

test('the worklet processor source wires port.onmessage through applyFrameSizeMessage too', () => {
  assert.match(PITCH_WORKLET_SOURCE, /applyFrameSizeMessage\(this, ev\.data\)/, 'processor must delegate to applyFrameSizeMessage');
});
