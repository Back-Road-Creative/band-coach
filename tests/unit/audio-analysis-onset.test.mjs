import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOnsetEnvelope } from '../../src/audio/analysis/onset-envelope.js';

const SR = 22050;

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

function clickTrack(seconds, bpm, sr) {
  const pcm = new Float32Array(Math.round(seconds * sr));
  const period = 60 / bpm;
  const clickLen = Math.round(0.005 * sr);
  for (let t = 0; t < seconds; t += period) {
    const start = Math.round(t * sr);
    for (let i = 0; i < clickLen && start + i < pcm.length; i++) {
      // short broadband burst (decaying noise-ish via alternating sign impulse)
      pcm[start + i] = (i % 2 === 0 ? 1 : -1) * (1 - i / clickLen);
    }
  }
  return pcm;
}

test('onset envelope is all-zero-ish for silence', () => {
  const { envelope, hopSeconds } = computeOnsetEnvelope(silence(1), SR, { frameSize: 1024, hopSize: 256 });
  assert.ok(envelope.length > 0);
  assert.ok(hopSeconds > 0);
  const max = Math.max(...envelope);
  assert.ok(max < 1e-6, `expected near-zero envelope, got max ${max}`);
});

test('onset envelope has peaks near click times', () => {
  const bpm = 120;
  const sr = SR;
  const pcm = clickTrack(4, bpm, sr);
  const frameSize = 1024;
  const hopSize = 256;
  const { envelope, hopSeconds } = computeOnsetEnvelope(pcm, sr, { frameSize, hopSize });
  const period = 60 / bpm;
  // for each expected click time, there should be a local envelope peak within +-2 hops
  for (let t = period; t < 3.5; t += period) {
    const centerFrame = Math.round(t / hopSeconds);
    let localMax = -Infinity;
    for (let f = Math.max(0, centerFrame - 3); f <= Math.min(envelope.length - 1, centerFrame + 3); f++) {
      localMax = Math.max(localMax, envelope[f]);
    }
    const globalMean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    assert.ok(localMax > globalMean * 1.5, `expected onset peak near t=${t}, localMax=${localMax}, mean=${globalMean}`);
  }
});
