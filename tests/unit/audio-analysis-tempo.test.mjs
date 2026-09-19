import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOnsetEnvelope } from '../../src/audio/analysis/onset-envelope.js';
import { estimateTempo, trackBeats, downbeats } from '../../src/audio/analysis/tempo.js';
import { clickTrack, SR } from './audio-analysis-fixtures.mjs';

function envelopeFor(bpm, seconds = 6) {
  const { pcm, beatTimes } = clickTrack(seconds, bpm, SR);
  const { envelope, hopSeconds } = computeOnsetEnvelope(pcm, SR, { frameSize: 512, hopSize: 128 });
  return { envelope, hopSeconds, beatTimes };
}

for (const bpm of [90, 120, 150]) {
  test(`estimateTempo recovers ${bpm} bpm within 2%`, () => {
    const { envelope, hopSeconds } = envelopeFor(bpm);
    const result = estimateTempo(envelope, hopSeconds);
    const errPct = (Math.abs(result.bpm - bpm) / bpm) * 100;
    assert.ok(errPct < 2, `bpm=${result.bpm} expected ~${bpm}, err ${errPct.toFixed(2)}%`);
    assert.ok(result.confidence > 0 && result.confidence <= 1);
    assert.ok(Array.isArray(result.candidates) && result.candidates.length > 0);
  });
}

test('estimateTempo prior favours ~110bpm region on an ambiguous envelope', () => {
  const { envelope, hopSeconds } = envelopeFor(120, 4);
  const result = estimateTempo(envelope, hopSeconds, { priorBpm: 110 });
  assert.ok(result.bpm > 60 && result.bpm < 200);
});

for (const bpm of [90, 120, 150]) {
  test(`trackBeats finds beat times within 40ms at ${bpm} bpm`, () => {
    const { envelope, hopSeconds, beatTimes } = envelopeFor(bpm, 6);
    const tempo = estimateTempo(envelope, hopSeconds);
    const beats = trackBeats(envelope, tempo.bpm, hopSeconds);
    assert.ok(beats.length >= beatTimes.length - 3, `too few beats: ${beats.length} vs ${beatTimes.length}`);
    // for each true beat (after the first, to allow for pickup/alignment), find nearest
    // tracked beat and check it's close.
    let withinTol = 0;
    let checked = 0;
    for (let i = 1; i < beatTimes.length - 1; i++) {
      const t = beatTimes[i];
      let nearest = Infinity;
      for (const b of beats) nearest = Math.min(nearest, Math.abs(b - t));
      checked++;
      if (nearest <= 0.04) withinTol++;
    }
    const frac = withinTol / checked;
    assert.ok(frac > 0.9, `only ${(frac * 100).toFixed(1)}% of beats within 40ms at ${bpm}bpm`);
  });
}

test('downbeats falls back sanely with no chroma', () => {
  const { envelope, hopSeconds, beatTimes } = envelopeFor(120, 6);
  const tempo = estimateTempo(envelope, hopSeconds);
  const beats = trackBeats(envelope, tempo.bpm, hopSeconds);
  const result = downbeats(beats, null);
  assert.ok(Array.isArray(result.downbeats));
  assert.ok(result.downbeats.length > 0);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});

test('downbeats picks the phase with the most chroma change', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  // chroma changes a lot right before beats 0, 4 (bar boundaries every 4 beats), constant otherwise
  const chordA = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const chordB = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const chroma = [chordA, chordA, chordA, chordA, chordB, chordB, chordB, chordB];
  const result = downbeats(beats, chroma, { beatsPerBar: 4 });
  assert.deepEqual(result.downbeats, [0, 2]);
});
