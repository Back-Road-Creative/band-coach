import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizeNotes, detectTuplets, inferPickup } from '../../src/song/quantize.js';
import { shiftBarline } from '../../src/song/edit.js';

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

// ---------- inferPickup + shiftBarline ----------

test('inferPickup: a one-beat pickup is inferred and applies cleanly via shiftBarline', () => {
  const metre = { num: 4, den: 4 };
  const barTicks = 4 * PPQ;
  // A recurring strong note every bar, phased 3 beats into the bar (i.e. the
  // piece's real downbeat pattern starts on "beat 4", one beat of pickup
  // before the next true downbeat).
  const quantized = [
    { midi: 60, tick: 3 * PPQ, durTicks: PPQ, confidence: 1 },
    { midi: 60, tick: 3 * PPQ + barTicks, durTicks: PPQ, confidence: 1 },
    { midi: 60, tick: 3 * PPQ + 2 * barTicks, durTicks: PPQ, confidence: 1 },
  ];
  const pickupTicks = inferPickup(quantized, metre, { ppq: PPQ });
  assert.equal(pickupTicks, PPQ); // one beat

  const song = {
    schema: 'song/1', id: 's1', title: 't', composer: null, licence: null, source: null,
    key: null, metre, bpm: 120, ticksPerQuarter: PPQ,
    parts: [{ id: 'p1', name: 'Melody', notes: quantized.map((n) => ({ start: n.tick, dur: n.durTicks, midi: n.midi })) }],
    chords: [],
  };
  const { song: shifted } = shiftBarline(song, pickupTicks);
  const starts = shifted.parts[0].notes.map((n) => n.start);
  starts.forEach((s) => assert.equal(s % barTicks, 0, 'shifted note should land exactly on a barline'));
});

test('inferPickup: a song with no pickup (downbeat already at tick 0) infers 0', () => {
  const metre = { num: 4, den: 4 };
  const barTicks = 4 * PPQ;
  const quantized = [
    { midi: 60, tick: 0, durTicks: PPQ, confidence: 1 },
    { midi: 60, tick: barTicks, durTicks: PPQ, confidence: 1 },
  ];
  assert.equal(inferPickup(quantized, metre, { ppq: PPQ }), 0);
});
