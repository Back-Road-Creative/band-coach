import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordSegments, isLowConfidence, clampLoopSelection } from '../../src/ui/playalong/timeline.js';

test('chordSegments turns per-beat chords into merged time ranges', () => {
  const beats = [0, 0.5, 1, 1.5, 2];
  const chords = [
    { startBeat: 0, symbol: 'C', confidence: 0.9 },
    { startBeat: 1, symbol: 'C', confidence: 0.8 },
    { startBeat: 2, symbol: 'G', confidence: 0.7 },
    { startBeat: 3, symbol: 'G', confidence: 0.6 },
    { startBeat: 4, symbol: 'N', confidence: 0.5 },
  ];
  const segs = chordSegments(chords, beats, 2.5);
  assert.equal(segs.length, 3);
  assert.deepEqual(
    segs.map((s) => ({ start: s.start, end: s.end, symbol: s.symbol, confidence: Number(s.confidence.toFixed(6)) })),
    [
      { start: 0, end: 1, symbol: 'C', confidence: 0.85 },
      { start: 1, end: 2, symbol: 'G', confidence: 0.65 },
      { start: 2, end: 2.5, symbol: 'N', confidence: 0.5 },
    ]
  );
});

test('chordSegments returns nothing for an empty chord list', () => {
  assert.deepEqual(chordSegments([], [], 10), []);
});

test('isLowConfidence flags below the threshold, defaulting to 0.35', () => {
  assert.equal(isLowConfidence(0.1), true);
  assert.equal(isLowConfidence(0.5), false);
  assert.equal(isLowConfidence(0.2, 0.5), true);
  assert.equal(isLowConfidence(0.6, 0.5), false);
});

test('clampLoopSelection orders and clamps a drag/keyboard selection to the track duration', () => {
  assert.deepEqual(clampLoopSelection(5, 2, 10), { start: 2, end: 5 });
  assert.deepEqual(clampLoopSelection(-3, 4, 10), { start: 0, end: 4 });
  assert.deepEqual(clampLoopSelection(3, 40, 10), { start: 3, end: 10 });
});

test('clampLoopSelection refuses a zero-length selection by nudging the end forward', () => {
  assert.deepEqual(clampLoopSelection(3, 3, 10), { start: 3, end: 3.25 });
  assert.deepEqual(clampLoopSelection(9.9, 9.9, 10), { start: 9.75, end: 10 });
});
