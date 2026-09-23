import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLessonPlan, HOLD_MIN_DURATION_SCORE, TUNE_MAX_MEAN_ABS_CENTS } from '../../src/song/lesson.js';
import { passesRule, holdTuneFeedback } from '../../src/ui/songs/practice.js';
import { centsFromFreq } from '../../src/ui/songs.js';
import cello from '../../src/instruments/cello.js';
import gtr from '../../src/instruments/gtr.js';
import kbd from '../../src/instruments/kbd.js';
import voice from '../../src/instruments/voice.js';

function oneNoteSong(bpm = 100) {
  return {
    schema: 'song/1', id: 'hold-tune-song', title: 'Hold Tune Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 60 }] }],
    chords: []
  };
}

// A song with two phrases so a chain step (phrases.length > 1) exists too.
function twoPhraseSong(bpm = 100) {
  return {
    schema: 'song/1', id: 'hold-tune-song-2', title: 'Hold Tune Song 2', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm, ticksPerQuarter: 480,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 },
        { start: 960, dur: 480, midi: 64 }, { start: 1440, dur: 480, midi: 65 },
        // A rest before the next note forces a phrase break here.
        { start: 3840, dur: 480, midi: 67 }, { start: 4320, dur: 480, midi: 69 }
      ]
    }],
    chords: []
  };
}

// ===================== sustaining families get hold/tune =====================

test('a sustaining instrument (cello, family bowed) gets hold and tune rules on pitch-bearing steps', () => {
  const plan = buildLessonPlan(oneNoteSong(), 'melody', cello);
  const byKind = Object.fromEntries(plan.steps.map(s => [s.kind, s]));
  assert.equal(byKind.listen.passRule, null);
  assert.equal(byKind.rhythm.passRule.minDurationScore, undefined, 'rhythm is not pitch-bearing enough to gate on hold/tune');
  assert.equal(byKind.rhythm.passRule.maxMeanAbsCents, undefined);
  for (const kind of ['pitches', 'phrase-slow', 'tempo-ladder', 'whole']) {
    assert.equal(byKind[kind].passRule.minDurationScore, HOLD_MIN_DURATION_SCORE, kind + ' should require a hold score');
    assert.equal(byKind[kind].passRule.maxMeanAbsCents, TUNE_MAX_MEAN_ABS_CENTS, kind + ' should require a tune score');
  }
});

test('a sustaining instrument gets hold/tune rules on the chain step too', () => {
  const plan = buildLessonPlan(twoPhraseSong(), 'melody', cello);
  const chainStep = plan.steps.find(s => s.kind === 'chain');
  assert.ok(chainStep, 'expected a chain step for a two-phrase song');
  assert.equal(chainStep.passRule.minDurationScore, HOLD_MIN_DURATION_SCORE);
  assert.equal(chainStep.passRule.maxMeanAbsCents, TUNE_MAX_MEAN_ABS_CENTS);
});

test('voice (family voice) also gets hold and tune rules', () => {
  const plan = buildLessonPlan(oneNoteSong(), 'melody', voice);
  const pitches = plan.steps.find(s => s.kind === 'pitches');
  assert.equal(pitches.passRule.minDurationScore, HOLD_MIN_DURATION_SCORE);
  assert.equal(pitches.passRule.maxMeanAbsCents, TUNE_MAX_MEAN_ABS_CENTS);
});

// ===================== non-sustaining families are untouched =====================

test('a non-sustaining instrument (guitar, family fretted) has byte-identical passRules to before this change', () => {
  const plan = buildLessonPlan(oneNoteSong(), 'melody', gtr);
  const byKind = Object.fromEntries(plan.steps.map(s => [s.kind, s]));
  assert.deepEqual(byKind.pitches.passRule, { hitRate: 0.8, maxMeanErrorMs: null });
  assert.deepEqual(byKind['phrase-slow'].passRule, { hitRate: 0.8, maxMeanErrorMs: 150 });
  assert.deepEqual(byKind['tempo-ladder'].passRule, { hitRate: 0.85, maxMeanErrorMs: 100 });
  assert.deepEqual(byKind.whole.passRule, { hitRate: 0.8, maxMeanErrorMs: 120 });
});

test('a non-sustaining instrument (piano/keys, kbd) has byte-identical passRules to before this change', () => {
  const plan = buildLessonPlan(oneNoteSong(), 'melody', kbd);
  const pitches = plan.steps.find(s => s.kind === 'pitches');
  assert.deepEqual(pitches.passRule, { hitRate: 0.8, maxMeanErrorMs: null });
});

// ===================== passesRule with hold/tune =====================

test('passesRule fails a step whose hitRate/timing are fine but the note was not held long enough', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 5, durationScore: 0.0, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(passesRule(result, passRule), false);
});

test('passesRule fails a step that is held fine but out of tune', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 90, durationScore: 1, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(passesRule(result, passRule), false);
});

test('passesRule passes a step that is held long enough and in tune', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 10, durationScore: 1, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(passesRule(result, passRule), true);
});

test('passesRule with a hold/tune rule still passes when the capture never measured duration or cents (mic gave no data)', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: null, durationScore: null, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(passesRule(result, passRule), true);
});

// ===================== holdTuneFeedback =====================

test('holdTuneFeedback names holding the note when that is the only thing that failed', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 5, meanCents: 5, durationScore: 0.0, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), 'Hold each note a little longer.');
});

test('holdTuneFeedback names being sharp when tuning (sharp) is the only thing that failed', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 90, meanCents: 90, durationScore: 1, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), 'A little sharp — aim for the middle of the note.');
});

test('holdTuneFeedback names being flat when tuning (flat) is the only thing that failed', () => {
  const result = { hitRate: 1, meanErrorMs: null, meanAbsCents: 90, meanCents: -90, durationScore: 1, judgedCount: 1 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), 'A little flat — aim for the middle of the note.');
});

test('holdTuneFeedback stays quiet when the hit rate itself is the problem', () => {
  const result = { hitRate: 0.2, meanErrorMs: null, meanAbsCents: 90, meanCents: 90, durationScore: 0, judgedCount: 5 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: null, minDurationScore: 0.6, maxMeanAbsCents: 40 };
  assert.equal(holdTuneFeedback(result, passRule), null);
});

test('holdTuneFeedback returns null for a step with no hold/tune rule at all', () => {
  const result = { hitRate: 0.2, meanErrorMs: 500, meanAbsCents: null, meanCents: null, durationScore: null, judgedCount: 5 };
  const passRule = { hitRate: 0.8, maxMeanErrorMs: 120 };
  assert.equal(holdTuneFeedback(result, passRule), null);
});

// ===================== centsFromFreq =====================

test('centsFromFreq reads 0 cents for an exactly-in-tune frequency', () => {
  const freq = 440 * Math.pow(2, (60 - 69) / 12); // midi 60, C4
  assert.ok(Math.abs(centsFromFreq(freq, 60)) < 0.01);
});

test('centsFromFreq reads positive cents for a sharp frequency and negative for a flat one', () => {
  const inTune = 440 * Math.pow(2, (60 - 69) / 12);
  const sharp = inTune * Math.pow(2, 20 / 1200); // 20 cents sharp
  const flat = inTune * Math.pow(2, -20 / 1200); // 20 cents flat
  assert.ok(centsFromFreq(sharp, 60) > 15 && centsFromFreq(sharp, 60) < 25);
  assert.ok(centsFromFreq(flat, 60) < -15 && centsFromFreq(flat, 60) > -25);
});

test('a mic note heard for a single tick is judged as clipped short, not skipped as unmeasured', async () => {
  const { playedEventFrom } = await import('../../src/ui/songs.js');
  const ev = playedEventFrom(261.63, 60, 1.0);
  assert.equal(ev.midi, 60);
  assert.equal(ev.atSec, 1.0);
  assert.ok(ev.durSec > 0, 'durSec must be a real (short) length, never null');
  assert.ok(Math.abs(ev.cents) < 1);
});

test('a held note that drifts sharp after its attack folds later ticks into cents, not just the onset', async () => {
  const { playedEventFrom, extendHeldEvent } = await import('../../src/ui/songs.js');
  const inTuneFreq = 440 * Math.pow(2, (60 - 69) / 12); // midi 60, exactly in tune
  const sharpFreq = inTuneFreq * Math.pow(2, 60 / 1200); // 60 cents sharp
  const ev = playedEventFrom(inTuneFreq, 60, 1.0); // attacked in tune
  assert.ok(Math.abs(ev.cents) < 1, 'onset should read as in tune');
  // The learner drifts sharp for the rest of the hold -- three more mic
  // ticks (50ms each) all reading ~60 cents sharp.
  extendHeldEvent(ev, sharpFreq, 60, 1.05);
  extendHeldEvent(ev, sharpFreq, 60, 1.10);
  extendHeldEvent(ev, sharpFreq, 60, 1.15);
  assert.ok(ev.cents > TUNE_MAX_MEAN_ABS_CENTS, `expected the drifted mean cents (${ev.cents}) to exceed the tune threshold (${TUNE_MAX_MEAN_ABS_CENTS}), catching the drift instead of only judging the in-tune attack`);
  assert.ok(Math.abs(ev.durSec - 0.15) < 1e-9, 'durSec must still stretch forward exactly as before');
});
