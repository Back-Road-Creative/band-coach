// Pure helpers behind Review's "Play original" / "Play notes" buttons and
// its unsure-notes list (src/ui/songs/review-playback.js, P3-7). No DOM, no
// AudioContext -- same "caller owns the clock" split as src/core/groove.js
// and src/audio/take-recorder.js. Confidence rule mirrors review.js:104's
// existing "low" band (< 0.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncertainNotesText, playbackPlanFor } from '../../src/ui/songs/review-playback.js';

const BPM = 120; // 1 tick @ TICKS_PER_QUARTER=480 quarter note = 0.5s at 120bpm

function song(notes) {
  return { bpm: BPM, parts: [{ id: 'p1', notes }] };
}

test('unsure notes are described in words, in order', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60, confidence: 0.9 },
    { start: 480, dur: 480, midi: 62, confidence: 0.2 },
    { start: 960, dur: 480, midi: 64, confidence: 0.1 },
  ];
  const text = uncertainNotesText(song(notes));
  assert.deepEqual(text, [
    'Note 2 (about 0.5 s in) — not sure',
    'Note 3 (about 1 s in) — not sure',
  ]);
});

test('a song with no unsure notes says so', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60, confidence: 0.9 },
    { start: 480, dur: 480, midi: 62, confidence: 0.7 },
  ];
  assert.deepEqual(uncertainNotesText(song(notes)), []);
});

test('a note right at the 0.4 confidence threshold is not counted as unsure', () => {
  const notes = [{ start: 0, dur: 480, midi: 60, confidence: 0.4 }];
  assert.deepEqual(uncertainNotesText(song(notes)), []);
});

test('a custom threshold widens or narrows which notes count as unsure', () => {
  const notes = [{ start: 0, dur: 480, midi: 60, confidence: 0.5 }];
  assert.deepEqual(uncertainNotesText(song(notes), 0.6), ['Note 1 (about 0 s in) — not sure']);
  assert.deepEqual(uncertainNotesText(song(notes), 0.4), []);
});

test('a song with no notes has no unsure notes', () => {
  assert.deepEqual(uncertainNotesText(song([])), []);
  assert.deepEqual(uncertainNotesText({ bpm: BPM, parts: [] }), []);
});

test('playbackPlanFor schedules every note from t0=0 in seconds', () => {
  const notes = [
    { start: 0, dur: 240, midi: 60, confidence: 0.9 },
    { start: 480, dur: 480, midi: 64, confidence: 0.9 },
  ];
  const plan = playbackPlanFor(song(notes));
  assert.deepEqual(plan, [
    { midi: 60, at: 0, dur: 0.25 },
    { midi: 64, at: 0.5, dur: 0.5 },
  ]);
});

test('playbackPlanFor is empty for a song with no notes', () => {
  assert.deepEqual(playbackPlanFor(song([])), []);
});
