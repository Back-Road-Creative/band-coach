// rmsLevel (src/ui/learn/level.js): the pure RMS-to-0..1 reading behind the
// mic door's level meter (plan §11.5.7, unit G1b). Plain Float32Array in, a
// clamped 0..1 number out -- no AnalyserNode, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmsLevel } from '../../src/ui/learn/level.js';

test('silence reads as 0', () => {
  assert.equal(rmsLevel(new Float32Array(512)), 0);
});

test('a full-scale square wave reads close to 1', () => {
  const buf = new Float32Array(512).fill(1);
  assert.ok(rmsLevel(buf) > 0.9, rmsLevel(buf));
});

test('a quiet steady tone reads proportionally low', () => {
  const buf = new Float32Array(512);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.1 * Math.sin(i);
  const level = rmsLevel(buf);
  assert.ok(level > 0 && level < 0.3, level);
});

test('is always clamped to 0..1 even given out-of-range samples', () => {
  const buf = new Float32Array([5, -5, 5, -5]);
  assert.ok(rmsLevel(buf) <= 1);
});

test('an empty or missing buffer reads as 0', () => {
  assert.equal(rmsLevel(new Float32Array(0)), 0);
  assert.equal(rmsLevel(null), 0);
  assert.equal(rmsLevel(undefined), 0);
});
