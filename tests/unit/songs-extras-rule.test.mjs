// Wave: extras hold-clean. An attempt that hits every expected note but ALSO
// plays wrong "extra" notes alongside a chord (src/ui/songs/practice.js
// judgeAttempt's extras.count/list, see practice-chord-judge.test.mjs) used
// to still pass because passesRule() never read result.extras at all. Now a
// step whose passRule carries maxExtras fails once extras.count exceeds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt, passesRule } from '../../src/ui/songs/practice.js';

test('passesRule fails an attempt that hit everything but also struck an extra note, when the rule sets maxExtras 0', () => {
  const result = { hitRate: 1, meanErrorMs: 0, judgedCount: 1, extras: { count: 1, list: [{ midi: 61 }] } };
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), false);
});

test('passesRule still passes a clean attempt (no extras) against the same maxExtras rule', () => {
  const result = { hitRate: 1, meanErrorMs: 0, judgedCount: 1, extras: { count: 0, list: [] } };
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), true);
});

test('passesRule ignores extras entirely when the rule has no maxExtras (backward compatible)', () => {
  const result = { hitRate: 1, meanErrorMs: 0, judgedCount: 1, extras: { count: 5, list: [] } };
  const passRule = { hitRate: 0.8 };
  assert.equal(passesRule(result, passRule), true);
});

test('passesRule does not blow up when a result carries no extras field at all', () => {
  const result = { hitRate: 1, meanErrorMs: 0, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), true);
});

// End-to-end through judgeAttempt's real chord-matching, the same setup
// practice-chord-judge.test.mjs uses: a two-note chord where every expected
// note is matched, plus one wrong note struck inside the chord's window.
test('a real judgeAttempt chord result with an extra note fails a maxExtras 0 passRule even though hitRate is perfect', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 0, dur: 480, midi: 64 },
  ];
  const played = [
    { midi: 60, atSec: 0.0 },
    { midi: 64, atSec: 0.01 },
    { midi: 61, atSec: 0.02 }, // wrong extra note, inside the chord's spread window
  ];
  const result = judgeAttempt(notes, played, { bpm: 120, ticksPerQuarter: 480 });
  assert.equal(result.hitRate, 1, 'both expected notes were matched');
  assert.equal(result.extras.count, 1);
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, maxExtras: 0 };
  assert.equal(passesRule(result, passRule), false);
});
