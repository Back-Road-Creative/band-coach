import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt, passesRule } from '../../src/ui/songs/practice.js';

const TPQ = 480;

test('a clean, on-time performance matches every note with zero error', () => {
  const expected = [
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 62 },
  ];
  const played = [
    { midi: 60, atSec: 0 },
    { midi: 62, atSec: 0.5 }, // one beat at 120bpm = 0.5s
  ];
  const result = judgeAttempt(expected, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact' });
  assert.equal(result.hitCount, 2);
  assert.equal(result.hitRate, 1);
  assert.equal(result.meanErrorMs, 0);
});

test('a wrong pitch is not matched and lowers the hit rate', () => {
  const expected = [
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 62 },
  ];
  const played = [{ midi: 60, atSec: 0 }, { midi: 65, atSec: 0.5 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 1);
  assert.equal(result.hitRate, 0.5);
});

test('a note played late is still matched, with a positive timing error', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 60, atSec: 0.12 }];
  const result = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  assert.equal(result.hitCount, 1);
  assert.equal(result.meanErrorMs, 120);
});

test('untimed matching (kind "pitches") ignores when a note was played, only its order', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 }];
  const played = [{ midi: 60, atSec: 9 }, { midi: 62, atSec: 40 }];
  const result = judgeAttempt(expected, played, { bpm: 120, timed: false });
  assert.equal(result.hitRate, 1);
  assert.equal(result.meanErrorMs, null);
});

test('octave policy is respected: nearest-octave accepts any octave for a singer', () => {
  const expected = [{ start: 0, dur: 480, midi: 60 }];
  const played = [{ midi: 72, atSec: 0 }];
  const exact = judgeAttempt(expected, played, { bpm: 120, policy: 'exact' });
  const nearest = judgeAttempt(expected, played, { bpm: 120, policy: 'nearest-octave' });
  assert.equal(exact.hitRate, 0);
  assert.equal(nearest.hitRate, 1);
});

test('an empty expected phrase has a hit rate of 0, never NaN or a crash', () => {
  const result = judgeAttempt([], [], { bpm: 120 });
  assert.equal(result.hitRate, 0);
  assert.equal(result.judgedCount, 0);
});

test('passesRule: a null passRule (a "listen" step) always passes', () => {
  assert.equal(passesRule({ hitRate: 0, meanErrorMs: null, judgedCount: 3 }, null), true);
});

test('passesRule: fails when the hit rate is below the rule', () => {
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 120 };
  assert.equal(passesRule({ hitRate: 0.5, meanErrorMs: 10, judgedCount: 4 }, passRule), false);
});

test('passesRule: fails when the mean timing error exceeds the rule', () => {
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 100 };
  assert.equal(passesRule({ hitRate: 1, meanErrorMs: 150, judgedCount: 4 }, passRule), false);
});

test('passesRule: a rule with no timing requirement (maxMeanErrorMs null) ignores timing', () => {
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null };
  assert.equal(passesRule({ hitRate: 1, meanErrorMs: 5000, judgedCount: 4 }, passRule), true);
});
