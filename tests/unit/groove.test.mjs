import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, scoreTake, tempoLadder } from '../../src/core/groove.js';

// ---------- makeGrid ----------

test('makeGrid: quarter notes at 120bpm, one bar of 4', () => {
  const g = makeGrid({ bpm: 120, beatsPerBar: 4, bars: 1, subdivision: 1, startTime: 0 });
  assert.equal(g.length, 4);
  assert.deepEqual(g, [0, 0.5, 1, 1.5]);
});

test('makeGrid: startTime offsets every beat', () => {
  const g = makeGrid({ bpm: 60, beatsPerBar: 2, bars: 1, subdivision: 1, startTime: 10 });
  assert.deepEqual(g, [10, 11]);
});

test('makeGrid: subdivision doubles the grid within each beat', () => {
  const g = makeGrid({ bpm: 60, beatsPerBar: 1, bars: 1, subdivision: 2, startTime: 0 });
  assert.deepEqual(g, [0, 0.5]);
});

test('makeGrid: multiple bars concatenate', () => {
  const g = makeGrid({ bpm: 60, beatsPerBar: 2, bars: 2, subdivision: 1, startTime: 0 });
  assert.deepEqual(g, [0, 1, 2, 3]);
});

test('makeGrid: a non-positive bpm returns an empty grid, never throws', () => {
  assert.deepEqual(makeGrid({ bpm: 0 }), []);
  assert.deepEqual(makeGrid({ bpm: -5 }), []);
  assert.deepEqual(makeGrid({}), []);
});

test('makeGrid: fractional/garbage counts are floored and clamped to at least 1', () => {
  const g = makeGrid({ bpm: 60, beatsPerBar: 0.4, bars: -3, subdivision: 0, startTime: 0 });
  assert.equal(g.length, 1);
});

// ---------- scoreTake ----------

test('scoreTake: an exactly-on-beat note is a hit with zero error', () => {
  const grid = [0, 0.5, 1, 1.5];
  const expected = [{ beat: 0, midi: 60 }];
  const onsets = [{ t: 0, midi: 60 }];
  const r = scoreTake({ onsets, grid, expected, latencyMs: 0, windowMs: 100 });
  assert.equal(r.notes[0].ok, true);
  assert.equal(r.notes[0].missed, false);
  assert.equal(r.notes[0].errorMs, 0);
  assert.equal(r.summary.hitRate, 1);
});

test('scoreTake: empty onsets means every expected note is missed', () => {
  const grid = [0, 0.5, 1, 1.5];
  const expected = [{ beat: 0 }, { beat: 1 }, { beat: 2 }, { beat: 3 }];
  const r = scoreTake({ onsets: [], grid, expected, windowMs: 100 });
  assert.equal(r.summary.hitCount, 0);
  assert.equal(r.summary.missedCount, 4);
  assert.equal(r.summary.hitRate, 0);
  assert.equal(r.summary.meanErrorMs, null);
  r.notes.forEach((n) => {
    assert.equal(n.missed, true);
    assert.equal(n.ok, false);
    assert.equal(n.errorMs, null);
  });
});

test('scoreTake: empty expected means nothing to hit, an empty note list, no throw', () => {
  const r = scoreTake({ onsets: [{ t: 0 }], grid: [0], expected: [], windowMs: 100 });
  assert.deepEqual(r.notes, []);
  assert.equal(r.summary.total, 0);
  assert.equal(r.summary.hitRate, 0);
  assert.equal(r.summary.extraCount, 1, 'the one onset with nothing to match is extra');
});

test('scoreTake: missing arguments entirely does not throw', () => {
  const r = scoreTake({});
  assert.deepEqual(r.notes, []);
  assert.equal(r.summary.total, 0);
});

test('scoreTake: a note outside the window is missed even though an onset exists nearby', () => {
  const grid = [0, 1];
  const expected = [{ beat: 0 }];
  const onsets = [{ t: 0.5 }]; // 500ms away, window is 100ms
  const r = scoreTake({ onsets, grid, expected, windowMs: 100 });
  assert.equal(r.notes[0].missed, true);
});

test('scoreTake: extra notes are counted separately and never steal a match from the wrong beat', () => {
  const grid = [0, 1, 2];
  const expected = [{ beat: 0 }, { beat: 2 }];
  const onsets = [{ t: 0 }, { t: 1 }, { t: 2 }]; // one extra onset at beat 1, which is not expected
  const r = scoreTake({ onsets, grid, expected, windowMs: 50 });
  assert.equal(r.summary.hitCount, 2);
  assert.equal(r.summary.extraCount, 1);
});

test('scoreTake: an early onset is reported with a negative errorMs, a late one positive', () => {
  const grid = [1];
  const early = scoreTake({ onsets: [{ t: 0.9 }], grid, expected: [{ beat: 0 }], windowMs: 200 });
  assert.ok(early.notes[0].errorMs < 0);
  assert.equal(early.notes[0].early, true);
  const late = scoreTake({ onsets: [{ t: 1.1 }], grid, expected: [{ beat: 0 }], windowMs: 200 });
  assert.ok(late.notes[0].errorMs > 0);
  assert.equal(late.notes[0].late, true);
});

test('scoreTake: latencyMs is subtracted before judging, cancelling a fixed output delay', () => {
  const grid = [1];
  // onset physically lands 80ms after the beat, but 80ms of that is output latency
  const r = scoreTake({ onsets: [{ t: 1.08 }], grid, expected: [{ beat: 0 }], latencyMs: 80, windowMs: 20 });
  assert.equal(r.notes[0].ok, true);
  assert.ok(Math.abs(r.notes[0].errorMs) < 1e-9);
});

test('scoreTake: wrong pitch on an on-time onset fails the note even though timing was fine', () => {
  const grid = [0];
  const r = scoreTake({ onsets: [{ t: 0, midi: 61 }], grid, expected: [{ beat: 0, midi: 60 }], windowMs: 50 });
  assert.equal(r.notes[0].pitchOk, false);
  assert.equal(r.notes[0].ok, false);
  assert.equal(r.notes[0].missed, false, 'it was matched in time, just the wrong note');
});

test('scoreTake: no midi on either side means pitch is not judged at all', () => {
  const grid = [0];
  const r = scoreTake({ onsets: [{ t: 0 }], grid, expected: [{ beat: 0 }], windowMs: 50 });
  assert.equal(r.notes[0].pitchOk, true);
  assert.equal(r.notes[0].ok, true);
});

test('scoreTake: a consistent late drag reports mean signed error and tendency "dragging"', () => {
  const grid = [0, 1, 2, 3];
  const expected = grid.map((_, i) => ({ beat: i }));
  const onsets = grid.map((t) => ({ t: t + 0.12 })); // consistently 120ms late
  const r = scoreTake({ onsets, grid, expected, windowMs: 200 });
  assert.equal(r.summary.tendency, 'dragging');
  assert.ok(Math.abs(r.summary.meanErrorMs - 120) < 1e-6, `expected ~120ms, got ${r.summary.meanErrorMs}`);
});

test('scoreTake: a consistent early rush reports tendency "rushing"', () => {
  const grid = [0, 1, 2, 3];
  const expected = grid.map((_, i) => ({ beat: i }));
  const onsets = grid.map((t) => ({ t: t - 0.09 }));
  const r = scoreTake({ onsets, grid, expected, windowMs: 200 });
  assert.equal(r.summary.tendency, 'rushing');
  assert.ok(r.summary.meanErrorMs < 0);
});

test('scoreTake: small scattered errors within 15ms average to "steady"', () => {
  const grid = [0, 1, 2, 3];
  const expected = grid.map((_, i) => ({ beat: i }));
  const onsets = [grid[0] + 0.005, grid[1] - 0.006, grid[2] + 0.004, grid[3] - 0.003].map((t) => ({ t }));
  const r = scoreTake({ onsets, grid, expected, windowMs: 100 });
  assert.equal(r.summary.tendency, 'steady');
});

test('scoreTake: consistencyMs is 0 for identical errors and grows with scatter', () => {
  const grid = [0, 1, 2, 3];
  const expected = grid.map((_, i) => ({ beat: i }));
  const tight = scoreTake({ onsets: grid.map((t) => ({ t: t + 0.02 })), grid, expected, windowMs: 100 });
  const loose = scoreTake({ onsets: [grid[0] + 0.02, grid[1] - 0.06, grid[2] + 0.08, grid[3] - 0.03].map((t) => ({ t })), grid, expected, windowMs: 100 });
  assert.ok(Math.abs(tight.summary.consistencyMs) < 1e-9);
  assert.ok(loose.summary.consistencyMs > tight.summary.consistencyMs);
});

// ---------- tempoLadder ----------

test('tempoLadder: a clean take steps the tempo up', () => {
  assert.equal(tempoLadder({ bpm: 80, passed: true, step: 6 }), 86);
});

test('tempoLadder: a missed take steps the tempo down', () => {
  assert.equal(tempoLadder({ bpm: 80, passed: false, step: 6 }), 74);
});

test('tempoLadder: never rises above the ceiling', () => {
  assert.equal(tempoLadder({ bpm: 165, passed: true, step: 6, max: 168 }), 168);
});

test('tempoLadder: never falls below the floor', () => {
  assert.equal(tempoLadder({ bpm: 52, passed: false, step: 6, min: 50 }), 50);
});

test('tempoLadder: defaults are sane when only bpm and passed are given', () => {
  const up = tempoLadder({ bpm: 80, passed: true });
  const down = tempoLadder({ bpm: 80, passed: false });
  assert.ok(up > 80);
  assert.ok(down < 80);
});

// The ladder is symmetric, so a miss followed by a clean take lands back on
// exactly where it started. That is correct behaviour, and it is also the
// hole that made tests/characterization/play-in-time.test.mjs fail a working
// app: that test retried the take up to five times but compared the final
// tempo against the tempo it had read BEFORE the first attempt, so any run
// whose first attempt missed reported "tempo should rise after a clean take:
// 80 -> 80". A clean take's rise has to be measured from the tempo that take
// was played at.
test('tempoLadder: a miss then a clean take returns to exactly the starting tempo', () => {
  const start = 80;
  const afterMiss = tempoLadder({ bpm: start, passed: false });
  const afterClean = tempoLadder({ bpm: afterMiss, passed: true });
  assert.equal(afterMiss, 74);
  assert.equal(afterClean, start, 'a round trip is a no-op, so it cannot be used as evidence of a rise');
  assert.ok(afterClean > afterMiss, 'measured from the take that was actually clean, the tempo did rise');
});
