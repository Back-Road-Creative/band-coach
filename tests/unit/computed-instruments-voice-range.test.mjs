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

// "Find my range" tags each sample with the stage it was sung in. A learner
// who breathes a few times on the low note makes many low samples and one
// high one; pooled, the interquartile rule threw the high note away as an
// outlier and saved {low: 48, high: 48} (CI, main 84c360c). Each stage's
// samples now only ever speak to their own end of the range.
test('estimateRange takes the low from the low stage and the high from the high stage', () => {
  const samples = [
    { midi: 48, ms: 900, stage: 'low' },
    { midi: 48, ms: 700, stage: 'low' },
    { midi: 48, ms: 500, stage: 'low' },
    { midi: 48, ms: 800, stage: 'low' },
    { midi: 48, ms: 600, stage: 'low' },
    { midi: 72, ms: 900, stage: 'high' }
  ];
  assert.deepEqual(estimateRange(samples), { low: 48, high: 72 });
});

test('estimateRange still trims a glitch within one stage', () => {
  const samples = [
    { midi: 48, ms: 600, stage: 'low' },
    { midi: 72, ms: 600, stage: 'high' },
    { midi: 71, ms: 600, stage: 'high' },
    { midi: 72, ms: 600, stage: 'high' },
    { midi: 73, ms: 600, stage: 'high' },
    { midi: 96, ms: 600, stage: 'high' } // sustained octave-jump glitch
  ];
  assert.deepEqual(estimateRange(samples), { low: 48, high: 73 });
});

// Pressing "now the highest" does not stop the learner's low note on the
// same instant: the high stage opens still hearing it, and pitch wobble
// (48 -> 49 -> 48) splits that tail into several held samples. They
// outnumbered the one real high note, the interquartile rule threw 72 away
// and the range saved as {low: 48, high: 48}. Samples recorded under a
// real run of the Find-my-range test under load (load average ~45).
test('estimateRange ignores the low note still sounding at the start of the high stage', () => {
  const samples = [
    { midi: 48, ms: 830, stage: 'low' },
    { midi: 48, ms: 1082, stage: 'high' },
    { midi: 49, ms: 556, stage: 'high' },
    { midi: 48, ms: 840, stage: 'high' },
    { midi: 47, ms: 653, stage: 'high' },
    { midi: 72, ms: 731, stage: 'high' }
  ];
  assert.deepEqual(estimateRange(samples), { low: 48, high: 72 });
});

test('estimateRange keeps the high stage as it is when nothing in it clears the low note', () => {
  const samples = [
    { midi: 55, ms: 800, stage: 'low' },
    { midi: 55, ms: 800, stage: 'high' },
    { midi: 56, ms: 800, stage: 'high' }
  ];
  assert.deepEqual(estimateRange(samples), { low: 55, high: 56 });
});
