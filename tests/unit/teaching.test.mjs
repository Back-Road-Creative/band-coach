// Wave: repair loop (plan §7B unit B2). explain -> demo -> guided -> check
// -> repair -> transfer (plan §4). A step that keeps failing the SAME thing
// twice gets isolated into a short repair exercise on just the failing
// notes, then returns to the original step -- instead of the learner
// repeating the whole phrase over and over with no narrower target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseOf, PHASES, nextPhase, repairFor } from '../../src/core/teaching.js';
import { failedDimension, firstCorrection } from '../../src/ui/songs/practice.js';

function hitMatch({ midi, errorMs = null, durRatio = 1, cents = null, start = 0 }) {
  return { note: { midi, start }, played: { midi, atSec: 0 }, ok: true, errorMs, durRatio, cents, velocityError: null };
}

function missMatch(midi, start = 0) {
  return { note: { midi, start }, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null };
}

// ---------------------------------------------------------------------------
// phaseOf / PHASES / nextPhase
// ---------------------------------------------------------------------------

test('PHASES names the whole §4 loop in order', () => {
  assert.deepEqual(PHASES, ['explain', 'demo', 'guided', 'check', 'repair', 'transfer']);
});

test('phaseOf: listen (no passRule) is explain', () => {
  assert.equal(phaseOf({ kind: 'listen', passRule: null }), 'explain');
});

test('phaseOf: rhythm and pitches are guided', () => {
  assert.equal(phaseOf({ kind: 'rhythm', passRule: {} }), 'guided');
  assert.equal(phaseOf({ kind: 'pitches', passRule: {} }), 'guided');
});

test('phaseOf: phrase-slow, tempo-ladder, chain, whole are check', () => {
  assert.equal(phaseOf({ kind: 'phrase-slow', passRule: {} }), 'check');
  assert.equal(phaseOf({ kind: 'tempo-ladder', passRule: {} }), 'check');
  assert.equal(phaseOf({ kind: 'chain', passRule: {} }), 'check');
  assert.equal(phaseOf({ kind: 'whole', passRule: {} }), 'check');
});

test('phaseOf: repair is repair', () => {
  assert.equal(phaseOf({ kind: 'repair', passRule: {} }), 'repair');
});

test('nextPhase: explain -> demo -> guided -> check regardless of passed', () => {
  assert.equal(nextPhase('explain', true), 'demo');
  assert.equal(nextPhase('demo', true), 'guided');
  assert.equal(nextPhase('guided', true), 'check');
});

test('nextPhase: check fail -> repair, check pass -> transfer', () => {
  assert.equal(nextPhase('check', false), 'repair');
  assert.equal(nextPhase('check', true), 'transfer');
});

test('nextPhase: repair pass -> check (return to the original step)', () => {
  assert.equal(nextPhase('repair', true), 'check');
});

// ---------------------------------------------------------------------------
// failedDimension (practice.js)
// ---------------------------------------------------------------------------

const passRule = {
  hitRate: 0.8, maxMeanErrorMs: 120, minDurationScore: 0.6, maxMeanAbsCents: 40, maxExtras: 0,
};

test('failedDimension: pitch when hit rate failed, indices are the missed matches', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 3, hitCount: 2,
    matches: [hitMatch({ midi: 60 }), missMatch(62, 480), hitMatch({ midi: 64 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'pitch', noteIndices: [1] });
});

test('failedDimension: onset when timing failed, indices are the hits over maxMeanErrorMs', () => {
  const result = {
    hitRate: 1, meanErrorMs: 150, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, errorMs: 40 }), hitMatch({ midi: 64, errorMs: 180 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'onset', noteIndices: [1] });
});

test('failedDimension: onset falls back to the single worst hit when none individually exceeds maxMeanErrorMs', () => {
  const result = {
    hitRate: 1, meanErrorMs: 130, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, errorMs: 100 }), hitMatch({ midi: 64, errorMs: -110 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'onset', noteIndices: [1] });
});

test('failedDimension: tune when only mean-abs-cents failed, indices are the hits over the cents threshold', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 60, durationScore: 1, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, cents: 10 }), hitMatch({ midi: 64, cents: 90 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'tune', noteIndices: [1] });
});

test('failedDimension: hold when only duration score failed, indices are the hits outside the duration band', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 0, judgedCount: 2, hitCount: 2,
    matches: [hitMatch({ midi: 60, durRatio: 1 }), hitMatch({ midi: 64, durRatio: 0.2 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'hold', noteIndices: [1] });
});

test('failedDimension: extras has an empty index list -- nothing to isolate', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 1, hitCount: 1,
    matches: [hitMatch({ midi: 60 })],
    extras: { count: 1, list: [{ midi: 67, atSec: 1.2 }] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: 'extras', noteIndices: [] });
});

test('failedDimension: null when the try actually passed', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 1, hitCount: 1,
    matches: [hitMatch({ midi: 60 })],
    extras: { count: 0, list: [] },
  };
  assert.deepEqual(failedDimension(result, passRule), { dim: null, noteIndices: [] });
});

test('firstCorrection: unchanged behaviour after the failedDimension extraction (existing 11 cases stay green -- spot check)', () => {
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 2, hitCount: 1,
    matches: [missMatch(60), hitMatch({ midi: 62 })],
    extras: { count: 0, list: [] },
  };
  assert.equal(firstCorrection(result, passRule), 'Missed the C4 — 1 of 2 notes.');
});

// ---------------------------------------------------------------------------
// repairFor (teaching.js)
// ---------------------------------------------------------------------------

const checkStep = {
  kind: 'phrase-slow', phraseIndex: 0, bars: [0, 1], originTick: 0, bpm: 90,
  notes: [
    { start: 0, dur: 240, midi: 60 },
    { start: 240, dur: 240, midi: 62 },
    { start: 480, dur: 240, midi: 64 },
    { start: 720, dur: 240, midi: 65 },
  ],
  passRule: { hitRate: 0.8, maxMeanErrorMs: 150, minDurationScore: 0.6, maxMeanAbsCents: 40, maxExtras: 0 },
};

test('repairFor: null when failedDimension found nothing to isolate (extras)', () => {
  const result = {
    hitRate: 1, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 4, hitCount: 4,
    matches: checkStep.notes.map((n) => hitMatch({ midi: n.midi, start: n.start })),
    extras: { count: 1, list: [{ midi: 67, atSec: 1.2 }] },
  };
  assert.equal(repairFor(checkStep, result, checkStep.passRule), null);
});

test('repairFor: pitch miss isolates the missed note plus one neighbour either side', () => {
  const result = {
    hitRate: 0.75, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 4, hitCount: 3,
    matches: [
      hitMatch({ midi: 60, start: 0 }),
      missMatch(62, 240),
      hitMatch({ midi: 64, start: 480 }),
      hitMatch({ midi: 65, start: 720 }),
    ],
    extras: { count: 0, list: [] },
  };
  const repair = repairFor(checkStep, result, checkStep.passRule);
  assert.equal(repair.kind, 'repair');
  assert.equal(repair.dim, 'pitch');
  assert.equal(repair.phraseIndex, checkStep.phraseIndex);
  assert.equal(repair.bars, checkStep.bars);
  assert.equal(repair.bpm, checkStep.bpm);
  assert.deepEqual(repair.notes.map((n) => n.midi), [60, 62, 64]);
  assert.equal(repair.originTick, 0);
  // pitch isolation is untimed, like the "pitches" step kind -- a missed
  // note's own timing was never what failed here.
  assert.equal(repair.passRule.maxMeanErrorMs, null);
  assert.ok(repair.passRule.hitRate <= 0.8);
});

test('repairFor: onset isolation clears the pitch timing threshold to null (untimed retry)', () => {
  const result = {
    hitRate: 1, meanErrorMs: 200, meanAbsCents: 5, durationScore: 1, judgedCount: 4, hitCount: 4,
    matches: [
      hitMatch({ midi: 60, start: 0 }),
      hitMatch({ midi: 62, start: 240, errorMs: 200 }),
      hitMatch({ midi: 64, start: 480 }),
      hitMatch({ midi: 65, start: 720 }),
    ],
    extras: { count: 0, list: [] },
  };
  const repair = repairFor(checkStep, result, checkStep.passRule);
  assert.equal(repair.dim, 'onset');
  assert.equal(repair.passRule.maxMeanErrorMs, checkStep.passRule.maxMeanErrorMs);
});

test('repairFor: caps the isolated notes at 6', () => {
  const bigStep = {
    ...checkStep,
    notes: Array.from({ length: 10 }, (_, i) => ({ start: i * 240, dur: 240, midi: 60 + i })),
  };
  const matches = bigStep.notes.map((n, i) => (i === 5 ? missMatch(n.midi, n.start) : hitMatch({ midi: n.midi, start: n.start })));
  const result = {
    hitRate: 0.5, meanErrorMs: 10, meanAbsCents: 5, durationScore: 1, judgedCount: 10, hitCount: 9,
    matches, extras: { count: 0, list: [] },
  };
  const repair = repairFor(bigStep, result, bigStep.passRule);
  assert.ok(repair.notes.length <= 6);
});

test('repairFor: pitches step (bpm 0, untimed) stays untimed in the repair', () => {
  const untimedStep = { ...checkStep, kind: 'pitches', bpm: 0, passRule: { ...checkStep.passRule, maxMeanErrorMs: null } };
  const result = {
    hitRate: 0.75, meanErrorMs: null, meanAbsCents: 5, durationScore: 1, judgedCount: 4, hitCount: 3,
    matches: [
      hitMatch({ midi: 60, start: 0 }),
      missMatch(62, 240),
      hitMatch({ midi: 64, start: 480 }),
      hitMatch({ midi: 65, start: 720 }),
    ],
    extras: { count: 0, list: [] },
  };
  const repair = repairFor(untimedStep, result, untimedStep.passRule);
  assert.equal(repair.bpm, 0);
});
