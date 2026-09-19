// E3: pitch tracking used to run on the main thread from setInterval(…, 50),
// allocating a 4096-float buffer per tick, with the YIN maths duplicated
// nowhere else — now it also runs inside an AudioWorkletProcessor. Since the
// shipped app is one bundled iife file with no sibling-file fetches (it runs
// from file://), the worklet's own code has to travel as a string loaded
// from a Blob URL, not a separate .js file — see createPitchNode().
//
// The drift risk that creates: the worklet string could quietly diverge from
// the main-thread yin()/onset code. This test is the drift guard — it reads
// the ACTUAL PITCH_WORKLET_SOURCE the app will use and asserts it embeds the
// exact source text of yin() and createOnsetDetector() via
// Function.prototype.toString(), not a hand-copied re-implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin } from '../../src/audio/yin.js';
import { createOnsetDetector } from '../../src/audio/onset.js';
import { PITCH_WORKLET_SOURCE, createPitchNode } from '../../src/audio/pitch-worklet.js';

test('the worklet source embeds the exact yin() source text (no hand-copy, no drift)', () => {
  assert.ok(PITCH_WORKLET_SOURCE.includes(yin.toString()), 'worklet source must contain yin.toString() verbatim');
});

test('the worklet source embeds the exact createOnsetDetector() source text', () => {
  assert.ok(
    PITCH_WORKLET_SOURCE.includes(createOnsetDetector.toString()),
    'worklet source must contain createOnsetDetector.toString() verbatim'
  );
});

test('the worklet source registers a processor and contains no import/export statements (must run as a classic worklet script)', () => {
  assert.match(PITCH_WORKLET_SOURCE, /registerProcessor\(/);
  assert.doesNotMatch(PITCH_WORKLET_SOURCE, /\bexport\s/, 'export statements are not valid inside a bare worklet script');
  assert.doesNotMatch(PITCH_WORKLET_SOURCE, /\bimport\s/, 'import statements would require a sibling-file fetch, forbidden from file://');
});

test('the worklet source posts onset and rms fields on its message port', () => {
  assert.match(PITCH_WORKLET_SOURCE, /onset/);
  assert.match(PITCH_WORKLET_SOURCE, /rms/);
  assert.match(PITCH_WORKLET_SOURCE, /postMessage/);
});

test('createPitchNode is a function that takes an AudioContext-like object', () => {
  assert.equal(typeof createPitchNode, 'function');
});

test('createPitchNode rejects instead of throwing when audioWorklet is unavailable', async () => {
  const fakeCtx = {}; // no .audioWorklet — simulates an old/unsupported browser
  await assert.rejects(() => createPitchNode(fakeCtx));
});
