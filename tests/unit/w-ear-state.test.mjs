// Pure ear-training panel state: per-exercise level/accuracy tracking and the
// small timing/pitch conversions the DOM layer (src/ui/ear.js) needs but
// keeps out of node:test's reach. No DOM here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultExerciseState,
  recordAnswer,
  accuracy,
  secondsPerQuarter,
  ticksToSeconds,
  secondsToTicks,
  tapsToOnsets,
  centsToMidi,
  segmentPitches,
} from '../../src/ui/ear/state.js';

test('defaultExerciseState starts at level 1 with no history', () => {
  assert.deepEqual(defaultExerciseState(), { level: 1, streak: 0, correct: 0, total: 0 });
});

test('recordAnswer moves up one level after a run of 3 correct answers', () => {
  let s = defaultExerciseState();
  s = recordAnswer(s, true, 5);
  s = recordAnswer(s, true, 5);
  assert.equal(s.level, 1, 'still level 1 after only two correct');
  s = recordAnswer(s, true, 5);
  assert.equal(s.level, 2, 'levels up on the third correct in a row');
  assert.equal(s.streak, 0, 'streak resets after a level change');
});

test('recordAnswer moves down one level after 2 wrong answers in a row', () => {
  let s = { level: 3, streak: 0, correct: 10, total: 10 };
  s = recordAnswer(s, false, 5);
  assert.equal(s.level, 3);
  s = recordAnswer(s, false, 5);
  assert.equal(s.level, 2, 'levels down on the second wrong in a row');
  assert.equal(s.streak, 0);
});

test('recordAnswer never levels above maxLevel or below 1', () => {
  let s = { level: 5, streak: 2, correct: 0, total: 0 };
  s = recordAnswer(s, true, 5);
  assert.equal(s.level, 5, 'caps at maxLevel');
  s = { level: 1, streak: -1, correct: 0, total: 0 };
  s = recordAnswer(s, false, 5);
  assert.equal(s.level, 1, 'floors at 1');
});

test('recordAnswer keeps a running correct/total count', () => {
  let s = defaultExerciseState();
  s = recordAnswer(s, true, 5);
  s = recordAnswer(s, false, 5);
  assert.equal(s.total, 2);
  assert.equal(s.correct, 1);
});

test('a mixed run never lets streak leak across a win/loss boundary', () => {
  let s = defaultExerciseState();
  s = recordAnswer(s, true, 5);
  s = recordAnswer(s, false, 5); // breaks the correct streak
  s = recordAnswer(s, true, 5);
  s = recordAnswer(s, true, 5);
  assert.equal(s.level, 1, 'two correct after one wrong is not a run of three');
});

test('accuracy is null with no attempts, else correct/total', () => {
  assert.equal(accuracy(defaultExerciseState()), null);
  assert.equal(accuracy({ level: 1, streak: 0, correct: 3, total: 4 }), 0.75);
});

test('secondsPerQuarter and tick/second conversions round-trip at a given tempo', () => {
  assert.equal(secondsPerQuarter(60), 1);
  assert.equal(secondsPerQuarter(120), 0.5);
  assert.equal(ticksToSeconds(480, 60), 1);
  assert.equal(ticksToSeconds(240, 120), 0.25);
  assert.equal(secondsToTicks(1, 60), 480);
  assert.equal(secondsToTicks(0.5, 120), 480);
});

test('tapsToOnsets anchors the first tap to tick 0', () => {
  const onsets = tapsToOnsets([10.0, 10.5, 11.0], 60);
  assert.deepEqual(onsets, [0, 240, 480]);
});

test('tapsToOnsets is empty for no taps', () => {
  assert.deepEqual(tapsToOnsets([], 60), []);
});

test('centsToMidi shifts a fractional midi by cents/100 semitones', () => {
  assert.equal(centsToMidi(60, 0), 60);
  assert.equal(centsToMidi(60, 50), 60.5);
  assert.equal(centsToMidi(60, -25), 59.75);
  assert.equal(centsToMidi(60), 60, 'cents defaults to 0');
});

test('segmentPitches collapses a noisy stream into stable distinct notes', () => {
  const samples = [null, 60, 60.1, 60, null, 64.05, 64, 64, null, null, 60, 60];
  assert.deepEqual(segmentPitches(samples), [60, 64, 60]);
});

test('segmentPitches ignores a single unstable blip', () => {
  const samples = [60, 60, 60, 67, 60, 60, 60];
  assert.deepEqual(segmentPitches(samples), [60]);
});

test('segmentPitches never repeats the same note back to back', () => {
  const samples = [60, 60, 60, null, 60, 60, 60];
  assert.deepEqual(segmentPitches(samples), [60]);
});
