import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRange, classify, exerciseRangeFor } from '../../src/instruments/how/voice-range.js';

test('estimateRange trims samples shorter than the sustain threshold', () => {
  const samples = [
    { midi: 60, ms: 800 },
    { midi: 90, ms: 50 }, // a blip, too short to count
    { midi: 65, ms: 600 }
  ];
  const range = estimateRange(samples);
  assert.equal(range.low, 60);
  assert.equal(range.high, 65);
});

test('estimateRange trims a sustained but statistically outlying reading', () => {
  const samples = [
    { midi: 60, ms: 500 },
    { midi: 61, ms: 500 },
    { midi: 62, ms: 500 },
    { midi: 63, ms: 500 },
    { midi: 64, ms: 500 },
    { midi: 100, ms: 500 } // sustained but wildly far from the cluster
  ];
  const range = estimateRange(samples);
  assert.equal(range.high, 64);
});

test('estimateRange returns null with no sustained samples', () => {
  assert.equal(estimateRange([{ midi: 60, ms: 100 }]), null);
});

test('classify returns the nearest voice type as a hint, not a verdict', () => {
  const result = classify({ low: 48, high: 72 }); // tenor-centred
  assert.equal(result.hint, 'tenor');
  assert.match(result.wording, /hint/);
});

test('classify picks soprano for a high comfortable range', () => {
  const result = classify({ low: 62, high: 86 });
  assert.equal(result.hint, 'soprano');
});

test('exerciseRangeFor pulls a margin in from both ends', () => {
  const ex = exerciseRangeFor({ low: 48, high: 72 }, 3);
  assert.equal(ex.low, 51);
  assert.equal(ex.high, 69);
});

test('exerciseRangeFor falls back to a single midpoint for a too-narrow range', () => {
  const ex = exerciseRangeFor({ low: 60, high: 61 }, 3);
  assert.equal(ex.low, ex.high);
  assert.equal(ex.low, 61);
});
