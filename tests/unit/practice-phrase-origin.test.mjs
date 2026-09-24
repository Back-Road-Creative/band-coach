import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt, passesRule, phraseSec } from '../../src/ui/songs/practice.js';

// One phrase-local clock (BC-01): a step is played back, captured and judged
// from its phrase's segment start tick (step.originTick, the bar the lesson
// cut the phrase at), never from song tick 0 and never from its first note.
const TPQ = 480;
const RHYTHM_RULE = { hitRate: 0.8, maxMeanErrorMs: 120 };

test('phraseSec: seconds from the phrase origin, not from song tick 0', () => {
  assert.equal(phraseSec(1920, 1920, 120, TPQ), 0);
  assert.equal(phraseSec(2400, 1920, 120, TPQ), 0.5);
  assert.equal(phraseSec(480, 0, 120, TPQ), 0.25 * 2); // a beat at 120bpm
});

test('a phrase starting at bar 2 (tick 1920), played right at phrase time 0, is on time', () => {
  const expected = [{ start: 1920, dur: 480, midi: 60 }, { start: 2400, dur: 480, midi: 62 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 62, atSec: 0.5 }];
  const result = judgeAttempt(expected, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact', originTick: 1920 });
  assert.equal(result.hitRate, 1);
  assert.equal(result.meanErrorMs, 0);
  assert.equal(passesRule(result, RHYTHM_RULE), true);
});

test('a pickup rest before the first note is kept: the note is expected a half-beat in', () => {
  // Segment starts at tick 0; first note at tick 240 (an eighth rest) -> 0.25 s at 120bpm.
  const expected = [{ start: 240, dur: 240, midi: 64 }];
  const onTime = judgeAttempt(expected, [{ midi: 64, atSec: 0.25 }], { bpm: 120, ticksPerQuarter: TPQ, originTick: 0 });
  assert.equal(onTime.hitRate, 1);
  assert.equal(onTime.meanErrorMs, 0);
  const early = judgeAttempt(expected, [{ midi: 64, atSec: 0 }], { bpm: 120, ticksPerQuarter: TPQ, originTick: 0 });
  assert.equal(early.hitRate, 1);
  assert.ok(Math.abs(early.meanErrorMs - 250) < 1e-9, 'timing error ' + early.meanErrorMs);
  assert.equal(passesRule(early, RHYTHM_RULE), false);
});

test('a pickup of one beat (tick 480) in a bar starting at tick 1920 is expected 0.5 s in', () => {
  const expected = [{ start: 2400, dur: 480, midi: 60 }];
  const r = judgeAttempt(expected, [{ midi: 60, atSec: 0.5 }], { bpm: 120, ticksPerQuarter: TPQ, originTick: 1920 });
  assert.equal(r.meanErrorMs, 0);
});

const RHYTHM = [
  { start: 1920, dur: 480, midi: 60 },
  { start: 2400, dur: 480, midi: 62 },
  { start: 2880, dur: 480, midi: 64 },
  { start: 3360, dur: 480, midi: 65 },
];

test('rhythm step: onsets are judged, pitch is ignored (wrong pitches at the right times pass)', () => {
  const played = [0, 0.5, 1, 1.5].map((atSec, i) => ({ midi: 40 + i * 7, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact', originTick: 1920, onsetsOnly: true });
  assert.equal(r.hitRate, 1);
  assert.equal(r.meanErrorMs, 0);
  assert.equal(passesRule(r, RHYTHM_RULE), true);
});

test('rhythm step: an unpitched clap (midi null) counts as an onset', () => {
  const played = [0, 0.5, 1, 1.5].map((atSec) => ({ midi: null, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, originTick: 1920, onsetsOnly: true });
  assert.equal(passesRule(r, RHYTHM_RULE), true);
});

test('rhythm step: the same claps 300 ms late fail', () => {
  const played = [0.3, 0.8, 1.3, 1.8].map((atSec) => ({ midi: null, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, originTick: 1920, onsetsOnly: true });
  assert.equal(passesRule(r, RHYTHM_RULE), false);
});

test('rhythm step: the same claps 300 ms early fail', () => {
  const played = [-0.3, 0.2, 0.7, 1.2].map((atSec) => ({ midi: null, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, originTick: 1920, onsetsOnly: true });
  assert.equal(passesRule(r, RHYTHM_RULE), false);
});

test('rhythm step: a stray extra clap between beats is an extra, not a shift of every later beat', () => {
  const played = [0, 0.26, 0.5, 1, 1.5].map((atSec) => ({ midi: null, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, originTick: 1920, onsetsOnly: true });
  assert.equal(r.hitRate, 1);
  assert.equal(r.meanErrorMs, 0);
  assert.equal(r.extras.count, 1);
});

test('rhythm step: one clap on a chord covers every note of that chord', () => {
  const chord = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 64 }, { start: 480, dur: 480, midi: 67 }];
  const r = judgeAttempt(chord, [{ midi: null, atSec: 0 }, { midi: null, atSec: 0.5 }], { bpm: 120, ticksPerQuarter: TPQ, onsetsOnly: true });
  assert.equal(r.hitRate, 1);
});

test('a pitched step still requires the right pitch (onsetsOnly off)', () => {
  const played = [0, 0.5, 1, 1.5].map((atSec, i) => ({ midi: 40 + i * 7, atSec }));
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact', originTick: 1920 });
  assert.equal(r.hitRate, 0);
});

test('rhythm step: each onset hit says whether its pitch was right too (pitchOk), a clap never is', () => {
  const played = [{ midi: 60, atSec: 0 }, { midi: null, atSec: 0.5 }, { midi: 50, atSec: 1 }, { midi: 65, atSec: 1.5 }];
  const r = judgeAttempt(RHYTHM, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact', originTick: 1920, onsetsOnly: true });
  assert.deepEqual(r.matches.map((m) => m.pitchOk), [true, false, false, true]);
});
