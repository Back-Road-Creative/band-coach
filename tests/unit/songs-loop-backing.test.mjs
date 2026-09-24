import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoopBackingTransport,
  applyAttemptToTransport,
  backingBpm,
  rateLabel,
} from '../../src/ui/songs/loop-backing.js';

test('a fresh transport starts at full speed (rate 1.0)', () => {
  const transport = createLoopBackingTransport();
  assert.equal(transport.getRate(), 1.0);
});

test('a missed attempt (nothing hits) steps the rate down', () => {
  const transport = createLoopBackingTransport();
  const rate = applyAttemptToTransport(transport, { hitCount: 1, judgedCount: 3 });
  assert.ok(rate < 1.0, 'rate should drop after a miss: ' + rate);
  assert.equal(transport.getRate(), rate);
});

test('nothing judged yet counts as a miss, not a clean loop', () => {
  const transport = createLoopBackingTransport();
  const rate = applyAttemptToTransport(transport, { hitCount: 0, judgedCount: 0 });
  assert.ok(rate < 1.0, 'an empty attempt should not read as clean: ' + rate);
});

test('a fully clean attempt at less than full speed steps the rate up', () => {
  const transport = createLoopBackingTransport();
  applyAttemptToTransport(transport, { hitCount: 0, judgedCount: 3 }); // miss first, so there is room to rise
  const before = transport.getRate();
  const rate = applyAttemptToTransport(transport, { hitCount: 3, judgedCount: 3 });
  assert.ok(rate > before, 'rate should rise after a clean loop: before=' + before + ' after=' + rate);
});

test('the rate clamps to loop.js\'s own floor after repeated misses', () => {
  const transport = createLoopBackingTransport();
  for (let i = 0; i < 50; i++) applyAttemptToTransport(transport, { hitCount: 0, judgedCount: 3 });
  assert.equal(transport.getRate(), 0.5);
});

test('the rate clamps to loop.js\'s own ceiling after repeated clean loops', () => {
  const transport = createLoopBackingTransport();
  for (let i = 0; i < 50; i++) applyAttemptToTransport(transport, { hitCount: 3, judgedCount: 3 });
  assert.equal(transport.getRate(), 1.0);
});

test('backingBpm scales and rounds the step bpm by the current rate', () => {
  assert.equal(backingBpm(100, 1.0), 100);
  assert.equal(backingBpm(100, 0.9), 90);
  assert.equal(backingBpm(60, 0.55), 33); // 33.0 exactly
});

test('backingBpm never returns less than 1', () => {
  assert.equal(backingBpm(1, 0.5), 1);
});

test('rateLabel reads "Full speed" at the ceiling, and a plain percentage below it', () => {
  assert.equal(rateLabel(1.0), 'Full speed');
  assert.equal(rateLabel(0.9), 'Playing at 90% speed');
  assert.equal(rateLabel(0.5), 'Playing at 50% speed');
});

// Wave: extras hold-clean. Before this, "clean" only meant hitCount ===
// judgedCount -- an attempt that hit every note but blew the step's own
// timing/hold/tune/extras rule still sped the backing up. Passing the
// step's passRule now decides "clean", via passesRule() (./practice.js).
test('an attempt with hitCount === judgedCount but a meanErrorMs above the passRule does NOT read as clean', () => {
  const transport = createLoopBackingTransport();
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 50 };
  const judged = { hitCount: 3, judgedCount: 3, hitRate: 1, meanErrorMs: 200 };
  const before = transport.getRate();
  const rate = applyAttemptToTransport(transport, judged, passRule);
  assert.ok(rate <= before, 'a rule-failing attempt should not raise the rate: before=' + before + ' after=' + rate);
  assert.equal(transport.getRate(), rate);
});

test('an attempt with hitCount === judgedCount but extras over the passRule does NOT read as clean', () => {
  const transport = createLoopBackingTransport();
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  const judged = { hitCount: 3, judgedCount: 3, hitRate: 1, meanErrorMs: 0, extras: { count: 1, list: [] } };
  const before = transport.getRate();
  const rate = applyAttemptToTransport(transport, judged, passRule);
  assert.ok(rate <= before, 'an attempt with a stray extra note should not raise the rate: before=' + before + ' after=' + rate);
});

test('an attempt that actually passes the passRule DOES read as clean and raises the rate', () => {
  const transport = createLoopBackingTransport();
  applyAttemptToTransport(transport, { hitCount: 0, judgedCount: 3, hitRate: 0 }); // miss first, room to rise
  const before = transport.getRate();
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 50 };
  const judged = { hitCount: 3, judgedCount: 3, hitRate: 1, meanErrorMs: 10 };
  const rate = applyAttemptToTransport(transport, judged, passRule);
  assert.ok(rate > before, 'a rule-passing attempt should raise the rate: before=' + before + ' after=' + rate);
});

test('applyAttemptToTransport keeps the old hit-count-only behaviour when no passRule is given', () => {
  const transport = createLoopBackingTransport();
  const rate = applyAttemptToTransport(transport, { hitCount: 3, judgedCount: 3, hitRate: 1, meanErrorMs: 9999 });
  assert.equal(rate, transport.getRate());
  assert.ok(rate >= 1.0, 'with no passRule, hitCount === judgedCount alone should still read as clean');
});
