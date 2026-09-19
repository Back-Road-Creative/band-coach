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
  test(`estimateTempo recovers ${bpm} bpm within 2%, and trackBeats finds beats within 40ms`, () => {
    const { envelope, hopSeconds, beatTimes } = envelopeFor(bpm);
    const tempo = estimateTempo(envelope, hopSeconds);
    const errPct = (Math.abs(tempo.bpm - bpm) / bpm) * 100;
    assert.ok(errPct < 2, `bpm=${tempo.bpm} err ${errPct.toFixed(2)}%`);
    assert.ok(tempo.confidence > 0 && tempo.confidence <= 1);
    assert.ok(tempo.candidates.length > 0);
    const beats = trackBeats(envelope, tempo.bpm, hopSeconds);
    assert.ok(beats.length >= beatTimes.length - 3, `${beats.length} vs ${beatTimes.length}`);
    let withinTol = 0, checked = 0;
    for (let i = 1; i < beatTimes.length - 1; i++) {
      let nearest = Infinity;
      for (const b of beats) nearest = Math.min(nearest, Math.abs(b - beatTimes[i]));
      checked++;
      if (nearest <= 0.04) withinTol++;
    }
    assert.ok(withinTol / checked > 0.9, `${((withinTol / checked) * 100).toFixed(1)}% within 40ms at ${bpm}bpm`);
  });
}

test('estimateTempo stays within the plausible tempo range on an ambiguous envelope', () => {
  const { envelope, hopSeconds } = envelopeFor(120, 4);
  const result = estimateTempo(envelope, hopSeconds, { priorBpm: 110 });
  assert.ok(result.bpm > 60 && result.bpm < 200);
});

test('downbeats falls back sanely with no chroma', () => {
  const { envelope, hopSeconds } = envelopeFor(120, 6);
  const tempo = estimateTempo(envelope, hopSeconds);
  const beats = trackBeats(envelope, tempo.bpm, hopSeconds);
  const result = downbeats(beats, null);
  assert.ok(Array.isArray(result.downbeats) && result.downbeats.length > 0);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});

test('downbeats picks the phase with the most chroma change', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const A = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const chroma = [A, A, A, A, B, B, B, B];
  const result = downbeats(beats, chroma, { beatsPerBar: 4 });
  assert.deepEqual(result.downbeats, [0, 2]);
});
