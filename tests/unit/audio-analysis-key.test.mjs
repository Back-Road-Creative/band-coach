import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateKey } from '../../src/audio/analysis/key.js';

// Krumhansl-Schmuckler profile shape for a plain C major scale weighting (tonic/dominant/
// mediant emphasised, matches the classic experiment's rank order).
const C_MAJOR_ISH = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

test('estimateKey recognises C major from a textbook-shaped profile', () => {
  const result = estimateKey(C_MAJOR_ISH);
  assert.equal(result.tonic, 0);
  assert.equal(result.mode, 'major');
  assert.ok(result.confidence > 0);
});

test('estimateKey recognises a rotated major key (G major)', () => {
  // rotate the C-major-shaped profile so index 7 (G, tonic+7) holds the tonic weight etc.
  const rotated = new Array(12);
  for (let i = 0; i < 12; i++) rotated[(i + 7) % 12] = C_MAJOR_ISH[i];
  const result = estimateKey(rotated);
  assert.equal(result.tonic, 7);
  assert.equal(result.mode, 'major');
});

test('estimateKey recognises A minor from a minor-shaped profile', () => {
  // Krumhansl-Kessler minor profile is tonic-relative (index 0 = tonic); rotate it so pitch
  // class 9 (A) holds the tonic weight, matching the tonic of A minor.
  const MINOR_TONIC_RELATIVE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const rotated = new Array(12);
  for (let i = 0; i < 12; i++) rotated[(i + 9) % 12] = MINOR_TONIC_RELATIVE[i];
  const result = estimateKey(rotated);
  assert.equal(result.tonic, 9);
  assert.equal(result.mode, 'minor');
});

test('estimateKey confidence is low for a flat (ambiguous) chroma vector', () => {
  const flat = new Array(12).fill(1);
  const result = estimateKey(flat);
  assert.ok(result.confidence < 0.3, `expected low confidence for flat input, got ${result.confidence}`);
});
