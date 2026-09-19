import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOnsetEnvelope } from '../../src/audio/analysis/onset-envelope.js';
import { clickTrack, SR } from './audio-analysis-fixtures.mjs';

test('onset envelope is near-zero for silence', () => {
  const { envelope, hopSeconds } = computeOnsetEnvelope(new Float32Array(SR), SR, { frameSize: 1024, hopSize: 256 });
  assert.ok(envelope.length > 0 && hopSeconds > 0);
  assert.ok(Math.max(...envelope) < 1e-6);
});

test('onset envelope has peaks near click times', () => {
  const bpm = 120, period = 60 / bpm;
  const { pcm } = clickTrack(4, bpm, SR);
  const { envelope, hopSeconds } = computeOnsetEnvelope(pcm, SR, { frameSize: 1024, hopSize: 256 });
  const globalMean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  for (let t = period; t < 3.5; t += period) {
    const centerFrame = Math.round(t / hopSeconds);
    let localMax = -Infinity;
    for (let f = Math.max(0, centerFrame - 3); f <= Math.min(envelope.length - 1, centerFrame + 3); f++) {
      localMax = Math.max(localMax, envelope[f]);
    }
    assert.ok(localMax > globalMean * 1.5, `t=${t} localMax=${localMax} mean=${globalMean}`);
  }
});
