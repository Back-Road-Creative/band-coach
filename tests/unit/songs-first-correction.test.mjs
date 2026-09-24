// Wave: first-correction feedback. songs.js's advance() used to fall back to
// the generic "Not quite yet -- try that again." for every failed try that
// wasn't hold/tune-only -- a missed note, a late note, and an extra note all
// read the same to the learner. firstCorrection() names the FIRST thing
// passesRule found wrong (same order passesRule checks in), so the learner
// gets one concrete, plain-word thing to fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstCorrection } from '../../src/ui/songs/practice.js';

const passRule = {
  hitRate: 0.8, maxMeanErrorMs: 120, minDurationScore: 0.6, maxMeanAbsCents: 40, maxExtras: 0,
};

function hitMatch({ midi, errorMs = null, durRatio = 1, cents = null }) {
  return { note: { midi }, played: { midi, atSec: 0 }, ok: true, errorMs, durRatio, cents, velocityError: null };
}

function missMatch(midi) {
  return { note: { midi }, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null };
}

test('firstCorrection returns null when the try passed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60 }), hitMatch({ midi: 62 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), null);
});

test('firstCorrection returns null when there is no passRule', () => {
  const result = { hitRate: 0, judgedCount: 0, hitCount: 0, matches: [], extras: { count: 0, list: [] } };
  assert.equal(firstCorrection(result, null), null);
});

test('firstCorrection (a) names the first missed note when hit rate failed', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 1,
    matches: [missMatch(60), hitMatch({ midi: 62 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Missed the C4 — 1 of 2 notes.');
});

test('firstCorrection (a) names a missed beat, not a note, when the miss has no pitch (rhythm step)', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: null, durationScore: 1, judgedCount: 2, hitCount: 1,
    matches: [missMatch(null), hitMatch({ midi: 62 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Missed a beat — 1 of 2.');
});

test('firstCorrection (b) names the worst-timed hit as late when timing failed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 150, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, errorMs: 40 }), hitMatch({ midi: 64, errorMs: 180 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'E4 was late by 180 ms — aim for the beat.');
});

test('firstCorrection (b) names the worst-timed hit as early when timing failed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 150, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, errorMs: -40 }), hitMatch({ midi: 64, errorMs: -180 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'E4 was early by 180 ms — aim for the beat.');
});

test('firstCorrection (c) defers to holdTuneFeedback when hit rate and timing both passed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, meanCents: 5, durationScore: 0, judgedCount: 1, hitCount: 1,
    matches: [hitMatch({ midi: 60, durRatio: 0.2 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Hold each note a little longer.');
});

test('firstCorrection (d) names the extra note when hit rate, timing and hold/tune all passed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 1, hitCount: 1,
    matches: [hitMatch({ midi: 60 })],
    extras: { count: 1, list: [{ midi: 67, atSec: 1.2 }] },
  };
  assert.equal(firstCorrection(result, passRule), 'An extra G4 crept in — just the written notes.');
});

test('firstCorrection (d) names a plain extra note when the extra has no pitch (a clap)', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 1, hitCount: 1,
    matches: [hitMatch({ midi: 60 })],
    extras: { count: 1, list: [{ midi: null, atSec: 1.2 }] },
  };
  assert.equal(firstCorrection(result, passRule), 'An extra note crept in — just the written notes.');
});

test('firstCorrection (e) falls back to the generic retry line when nothing else explains the failure', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 1,
    matches: [],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Not quite yet — try that again.');
});

test('firstCorrection precedence: a miss AND a late note both present -> the miss line wins', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 150, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 1,
    matches: [missMatch(60), hitMatch({ midi: 64, errorMs: 180 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Missed the C4 — 1 of 2 notes.');
});
