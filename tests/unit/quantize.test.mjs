import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizeNotes, detectTuplets } from '../../src/song/quantize.js';

const PPQ = 480;
const FLAT_120 = [{ tick: 0, bpm: 120 }];

// ---------- quantizeNotes: exact onsets ----------

test('quantizeNotes: onsets exactly on the grid get confidence 1', () => {
  const notes = [
    { midi: 60, startSec: 0, durSec: 0.5 },   // beat 0
    { midi: 62, startSec: 0.5, durSec: 0.5 }, // beat 1
    { midi: 64, startSec: 1.0, durSec: 0.5 }, // beat 2
  ];
  const out = quantizeNotes(notes, FLAT_120, { ppq: PPQ });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((n) => n.tick), [0, PPQ, 2 * PPQ]);
  out.forEach((n) => assert.equal(n.confidence, 1));
});

// ---------- quantizeNotes: jitter ----------

test('quantizeNotes: onsets jittered by +-20ms still snap to the right tick, with lower confidence', () => {
  const notes = [
    { midi: 60, startSec: 0.02, durSec: 0.5 },   // 20ms late
    { midi: 62, startSec: 0.48, durSec: 0.5 },   // 20ms early
  ];
  const out = quantizeNotes(notes, FLAT_120, { ppq: PPQ });
  assert.deepEqual(out.map((n) => n.tick), [0, PPQ]);
  out.forEach((n) => {
    assert.ok(n.confidence < 1, 'jittered onset should score below 1');
    assert.ok(n.confidence > 0, 'a 20ms jitter is nowhere near half a grid unit away');
  });
});

test('quantizeNotes: an onset a full half-grid-unit away scores confidence 0', () => {
  // straight 16th unit at 120bpm/480ppq is 120 ticks == 0.125s; half a unit
  // is 60 ticks == 0.0625s away from the nearest grid point.
  const notes = [{ midi: 60, startSec: 0.0625, durSec: 0.2 }];
  const out = quantizeNotes(notes, FLAT_120, { ppq: PPQ, grid: 'straight' });
  assert.equal(out[0].confidence, 0);
});

// ---------- quantizeNotes: two-segment tempo map ----------

test('quantizeNotes: a tempo change mid-piece quantises both halves correctly', () => {
  // bar 1 at 120bpm (4 beats = 1920 ticks = 2s), then a drop to 90bpm.
  const tempoMap = [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 90 }];
  const notes = [
    { midi: 60, startSec: 0, durSec: 0.5 },        // first segment, beat 0
    { midi: 62, startSec: 1.5, durSec: 0.5 },      // first segment, beat 3
    { midi: 64, startSec: 2 + 60 / 90, durSec: 0.5 }, // second segment, 1 beat in
  ];
  const out = quantizeNotes(notes, tempoMap, { ppq: PPQ });
  assert.deepEqual(out.map((n) => n.tick), [0, 3 * PPQ, 1920 + PPQ]);
  out.forEach((n) => assert.equal(n.confidence, 1));
});

// ---------- detectTuplets ----------

test('detectTuplets: a triplet beat fits the triplet grid markedly better than straight', () => {
  // Beat 0: three evenly-spaced onsets at 0, 1/3, 2/3 of a beat -- a triplet.
  const tripletTicks = [0, PPQ / 3, (2 * PPQ) / 3];
  const grids = detectTuplets(tripletTicks, { ppq: PPQ });
  assert.equal(grids.get(0), 'triplet');
});

test('detectTuplets: a straight beat is not misread as a triplet', () => {
  const straightTicks = [0, PPQ / 4, PPQ / 2, (3 * PPQ) / 4];
  const grids = detectTuplets(straightTicks, { ppq: PPQ });
  assert.equal(grids.get(0), 'straight');
});

test('quantizeNotes: notes in a triplet beat snap to the triplet grid, not straight', () => {
  const notes = [
    { midi: 60, startSec: 0, durSec: 0.1 },
    { midi: 62, startSec: (1 / 3) * 0.5, durSec: 0.1 },
    { midi: 64, startSec: (2 / 3) * 0.5, durSec: 0.1 },
  ];
  const out = quantizeNotes(notes, FLAT_120, { ppq: PPQ });
  assert.deepEqual(out.map((n) => n.tick), [0, Math.round(PPQ / 3), Math.round((2 * PPQ) / 3)]);
});
