import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateKey } from '../../src/audio/analysis/key.js';

// Krumhansl-Kessler tonal hierarchy ratings, tonic-relative (index 0 = tonic).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function rotate(profile, tonic) {
  const out = new Array(12);
  for (let i = 0; i < 12; i++) out[(i + tonic) % 12] = profile[i];
  return out;
}

test('estimateKey recognises C major from a textbook-shaped profile', () => {
  const r = estimateKey(MAJOR);
  assert.equal(r.tonic, 0); assert.equal(r.mode, 'major'); assert.ok(r.confidence > 0);
});

test('estimateKey recognises a rotated major key (G major)', () => {
  const r = estimateKey(rotate(MAJOR, 7));
  assert.equal(r.tonic, 7); assert.equal(r.mode, 'major');
});

test('estimateKey recognises A minor from a rotated minor profile', () => {
  const r = estimateKey(rotate(MINOR, 9));
  assert.equal(r.tonic, 9); assert.equal(r.mode, 'minor');
});

test('estimateKey confidence is low for a flat (ambiguous) chroma vector', () => {
  const r = estimateKey(new Array(12).fill(1));
  assert.ok(r.confidence < 0.3, `got ${r.confidence}`);
});
