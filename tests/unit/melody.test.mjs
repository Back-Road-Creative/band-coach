// trackContours/pickMelody: turn a flat, possibly-overlapping list of
// detected notes (what a multipitch tracker emits) into monophonic melodic
// lines ("contours"), then pick the one most likely to be the melody. Pure:
// no DOM, no AudioContext, the caller owns the clock (ticks are just numbers
// here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trackContours, pickMelody } from '../../src/song/melody.js';

test('trackContours separates two simultaneous, pitch-separated voices into two contours', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 48 },
    { start: 480, dur: 480, midi: 62 }, { start: 480, dur: 480, midi: 50 },
  ];
  const contours = trackContours(notes);
  assert.equal(contours.length, 2);
  const high = contours.find((c) => c.notes[0].midi === 60);
  const low = contours.find((c) => c.notes[0].midi === 48);
  assert.deepEqual(high.notes.map((n) => n.midi), [60, 62]);
  assert.deepEqual(low.notes.map((n) => n.midi), [48, 50]);
});

test('trackContours keeps contour identity through a pitch crossing (no flip-flop)', () => {
  // An ascending line and a descending line cross around step 3; naive
  // "nearest previous pitch" matching swaps identities right at the
  // crossing frame -- this is the failure mode this test guards against.
  const steps = [[60, 76], [63, 73], [66, 70], [69, 67], [72, 64], [75, 61]];
  const notes = [];
  steps.forEach(([a, b], i) => { const start = i * 480; notes.push({ start, dur: 480, midi: a }, { start, dur: 480, midi: b }); });
  const contours = trackContours(notes);
  assert.equal(contours.length, 2, 'exactly two voices tracked, no spurious extra contours from the crossing');
  const ascending = contours.find((c) => c.notes[0].midi === 60);
  const descending = contours.find((c) => c.notes[0].midi === 76);
  assert.deepEqual(ascending.notes.map((n) => n.midi), [60, 63, 66, 69, 72, 75], 'ascending voice never jumps to the other line at the crossing');
  assert.deepEqual(descending.notes.map((n) => n.midi), [76, 73, 70, 67, 64, 61], 'descending voice never jumps to the other line at the crossing');
});

test('pickMelody chooses the highest, best-covered contour', () => {
  const contours = trackContours([
    { start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 48 },
    { start: 480, dur: 480, midi: 62 }, { start: 480, dur: 480, midi: 50 },
  ]);
  const id = pickMelody(contours);
  const chosen = contours.find((c) => c.id === id);
  assert.equal(chosen.notes[0].midi, 60);
});

test('pickMelody sticks with the previous choice under hysteresis when scores are close', () => {
  const contours = trackContours([
    { start: 0, dur: 480, midi: 64 }, { start: 0, dur: 480, midi: 62 },
    { start: 480, dur: 480, midi: 64 }, { start: 480, dur: 480, midi: 63 },
  ]);
  const first = pickMelody(contours);
  const other = contours.find((c) => c.id !== first).id;
  const stuck = pickMelody(contours, { previousId: other, hysteresis: 5 });
  assert.equal(stuck, other, 'a close-scoring contour should not steal the melody pick every call');
});

test('pickMelody returns null for an empty contour list', () => {
  assert.equal(pickMelody([]), null);
});
