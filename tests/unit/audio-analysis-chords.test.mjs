import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateChords } from '../../src/audio/analysis/chords.js';

function triadChroma(rootPc, intervals) {
  const v = new Float32Array(12);
  for (const iv of intervals) v[(rootPc + iv) % 12] = 1;
  return v;
}

for (const [label, root, intervals, expected] of [
  ['a minor triad', 9, [0, 3, 7], 'Am'],
  ['a dominant 7th chord', 7, [0, 4, 7, 10], 'G7'],
]) {
  test(`estimateChords labels ${label}`, () => {
    const beatChroma = new Array(6).fill(0).map(() => triadChroma(root, intervals));
    const result = estimateChords(beatChroma);
    const correct = result.filter((c) => c.symbol === expected).length;
    assert.ok(correct / result.length >= 0.8, `only ${correct}/${result.length}: ${result.map((c) => c.symbol)}`);
  });
}

test('estimateChords labels a clean major triad sequence correctly (C-F-G-C)', () => {
  const seq = ['C', 'F', 'G', 'C'], roots = [0, 5, 7, 0];
  const beatChroma = roots.flatMap((root) => new Array(4).fill(0).map(() => triadChroma(root, [0, 4, 7])));
  const result = estimateChords(beatChroma);
  let correct = 0;
  for (let i = 0; i < result.length; i++) if (result[i].symbol === seq[Math.floor(i / 4)]) correct++;
  assert.ok(correct / result.length >= 0.8, `only ${correct}/${result.length}: ${result.map((c) => c.symbol)}`);
});

test('estimateChords reports N (no chord) for silence', () => {
  const result = estimateChords([new Float32Array(12), new Float32Array(12), new Float32Array(12)]);
  for (const c of result) assert.equal(c.symbol, 'N');
});

test('estimateChords self-transition bias smooths a single noisy beat', () => {
  const noisy = triadChroma(0, [0, 4, 7]); noisy[2] += 0.3; noisy[6] += 0.2;
  const beatChroma = [triadChroma(0, [0, 4, 7]), triadChroma(0, [0, 4, 7]), noisy, triadChroma(0, [0, 4, 7]), triadChroma(0, [0, 4, 7])];
  const result = estimateChords(beatChroma, { selfBias: 0.5 });
  const correct = result.filter((c) => c.symbol === 'C').length;
  assert.ok(correct >= 4, `${correct}/5: ${result.map((c) => c.symbol)}`);
});

test('estimateChords returns startBeat indices matching position and valid confidence', () => {
  const result = estimateChords([triadChroma(0, [0, 4, 7]), triadChroma(5, [0, 4, 7])]);
  assert.equal(result[0].startBeat, 0);
  assert.equal(result[1].startBeat, 1);
  for (const c of result) assert.ok(c.confidence >= 0 && c.confidence <= 1);
});
