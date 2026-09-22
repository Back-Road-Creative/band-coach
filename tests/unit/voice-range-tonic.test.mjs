import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseRangeFor, tonicFromRange } from '../../src/instruments/how/voice-range.js';

test('tonicFromRange places the tonic at the low end so degrees 0-12 climb the whole span', () => {
  const ex = exerciseRangeFor({ low: 48, high: 72 }, 3); // {51, 69}
  const t = tonicFromRange(ex);
  assert.equal(t.tonic, 51);
  assert.equal(t.stretch, false);
});

test('tonicFromRange flags a stretch when the exercise range is under an octave', () => {
  const ex = exerciseRangeFor({ low: 55, high: 62 }, 3); // {58, 59}, span 1
  const t = tonicFromRange(ex);
  assert.equal(t.tonic, 58);
  assert.equal(t.stretch, true);
});

test('tonicFromRange still returns a usable tonic for a single-point exercise range', () => {
  const ex = exerciseRangeFor({ low: 60, high: 61 }, 3); // collapses to a midpoint
  const t = tonicFromRange(ex);
  assert.equal(t.tonic, ex.low);
  assert.equal(t.stretch, true);
});
