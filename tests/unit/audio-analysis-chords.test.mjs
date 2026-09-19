import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateChords } from '../../src/audio/analysis/chords.js';

function triadChroma(rootPc, intervals) {
  const v = new Float32Array(12);
  for (const iv of intervals) v[(rootPc + iv) % 12] = 1;
  return v;
}

test('estimateChords labels a clean major triad sequence correctly', () => {
  const seq = ['C', 'F', 'G', 'C'];
  const roots = [0, 5, 7, 0];
  const beatChroma = [];
  for (const root of roots) {
    for (let i = 0; i < 4; i++) beatChroma.push(triadChroma(root, [0, 4, 7]));
  }
  const result = estimateChords(beatChroma);
  assert.equal(result.length, beatChroma.length);
  let correct = 0;
  for (let i = 0; i < result.length; i++) {
    const expected = seq[Math.floor(i / 4)];
    if (result[i].symbol === expected) correct++;
  }
  assert.ok(correct / result.length >= 0.8, `only ${correct}/${result.length} correct: ${result.map((c) => c.symbol)}`);
});

test('estimateChords labels a minor triad correctly', () => {
  const beatChroma = [];
  for (let i = 0; i < 6; i++) beatChroma.push(triadChroma(9, [0, 3, 7])); // A minor
  const result = estimateChords(beatChroma);
  const correct = result.filter((c) => c.symbol === 'Am').length;
  assert.ok(correct / result.length >= 0.8, `only ${correct}/${result.length} correct: ${result.map((c) => c.symbol)}`);
});

test('estimateChords labels a dominant 7th chord', () => {
  const beatChroma = [];
  for (let i = 0; i < 6; i++) beatChroma.push(triadChroma(7, [0, 4, 7, 10])); // G7
  const result = estimateChords(beatChroma);
  const correct = result.filter((c) => c.symbol === 'G7').length;
  assert.ok(correct / result.length >= 0.8, `only ${correct}/${result.length} correct: ${result.map((c) => c.symbol)}`);
});

test('estimateChords reports N (no chord) for silence', () => {
  const beatChroma = [new Float32Array(12), new Float32Array(12), new Float32Array(12)];
  const result = estimateChords(beatChroma);
  for (const c of result) assert.equal(c.symbol, 'N');
});

test('estimateChords self-transition bias smooths a single noisy beat', () => {
  const beatChroma = [
    triadChroma(0, [0, 4, 7]),
    triadChroma(0, [0, 4, 7]),
    // one noisy beat that's a weak, ambiguous mix — should still be smoothed toward context
    (() => { const v = triadChroma(0, [0, 4, 7]); v[2] += 0.3; v[6] += 0.2; return v; })(),
    triadChroma(0, [0, 4, 7]),
    triadChroma(0, [0, 4, 7]),
  ];
  const result = estimateChords(beatChroma, { selfBias: 0.5 });
  const correct = result.filter((c) => c.symbol === 'C').length;
  assert.ok(correct >= 4, `expected smoothing to keep most beats as C, got ${correct}/5: ${result.map((c) => c.symbol)}`);
});

test('estimateChords returns startBeat indices matching position', () => {
  const beatChroma = [triadChroma(0, [0, 4, 7]), triadChroma(5, [0, 4, 7])];
  const result = estimateChords(beatChroma);
  assert.equal(result[0].startBeat, 0);
  assert.equal(result[1].startBeat, 1);
  for (const c of result) assert.ok(c.confidence >= 0 && c.confidence <= 1);
});
