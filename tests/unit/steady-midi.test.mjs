// The "Find my range" characterization test waits for a held pitch with
// steadyMidiTracker(). Under CI load the pitch detector drops frames (a
// null reading) in the middle of a held tone; the app's own range test
// (handleRangeTest('tick') in src/app.js) ignores those and keeps timing
// the same note, so the wait must too, or it never sees 700ms "steady" and
// times out (main 84c360c, run 35789400001: "wanted midi 48 steady for
// 700ms, last saw 73").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steadyMidiTracker } from '../helpers/steady-midi.mjs';

function feed(targetMidi, holdMs, readings) {
  const observe = steadyMidiTracker(targetMidi, holdMs);
  for (const [now, midi] of readings) if (observe(midi, now)) return now;
  return null;
}

test('a held note with dropped frames (null) still counts as steady', () => {
  // Shape of a real trace captured at load average 25: 48 with a dropout
  // every few polls, never 700ms of unbroken 48s.
  const readings = [[0, 48], [60, 48], [120, null], [180, 48], [240, 48], [300, null],
    [360, 48], [420, 48], [480, null], [540, 48], [600, 48], [660, null], [720, 48]];
  assert.equal(feed(48, 700, readings), 720);
});

test('a different pitch still restarts the hold', () => {
  const readings = [[0, 48], [300, 48], [400, 73], [500, 48], [900, 48], [1200, 48]];
  assert.equal(feed(48, 700, readings), 1200);
});

test('never hearing the target is never steady', () => {
  const readings = [[0, null], [400, 72], [800, null], [1200, 72]];
  assert.equal(feed(48, 700, readings), null);
});

test('an unbroken hold completes at exactly holdMs', () => {
  const readings = [[100, 72], [400, 72], [799, 72], [800, 72]];
  assert.equal(feed(72, 700, readings), 800);
});
