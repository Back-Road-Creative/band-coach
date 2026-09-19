import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/melodic-dictation.js';

const MAJOR_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

test('determinism, free-response shape, note-count ramp, and diatonic phrases', () => {
  assert.deepEqual(make(3, 8), make(3, 8));
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
    const n = make(level, 0).answer.length;
    assert.ok(n >= last && n >= 3 && n <= 8, `level ${level} bad note count ${n}`);
    last = n;
    for (let seed = 0; seed < 8; seed++) {
      const q = make(level, seed);
      const tonicPc = NOTE_NAMES.indexOf(/Key: ([A-G]#?) major/.exec(q.explain)[1]);
      q.answer.forEach((m) => assert.ok(MAJOR_PCS.has(((m - tonicPc) % 12 + 12) % 12), `non-diatonic at level ${level}`));
    }
  }
});

test('level 1-2 phrases move stepwise only; higher levels allow wider leaps', () => {
  const maxLeap = (level) => {
    let max = 0;
    for (let seed = 0; seed < 20; seed++) {
      const midi = make(level, seed).answer;
      for (let i = 1; i < midi.length; i++) max = Math.max(max, Math.abs(midi[i] - midi[i - 1]));
    }
    return max;
  };
  assert.ok(maxLeap(1) <= 2 && maxLeap(2) <= 2);
  assert.ok(maxLeap(5) > maxLeap(1));
});

test('check(): exact/wrong/short/octave-folded responses are graded correctly', () => {
  const q = make(2, 5);
  assert.equal(check(q, q.answer).ok, true);
  const bad = q.answer.slice();
  bad[0] += 5;
  const wrongResult = check(q, bad);
  assert.equal(wrongResult.ok, false);
  assert.equal(wrongResult.detail.wrong[0].index, 0);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
  const upAnOctave = q.answer.map((m) => m + 12);
  assert.equal(check(q, upAnOctave, { foldOctave: true }).ok, true);
  assert.equal(check(q, upAnOctave, { foldOctave: false }).ok, false);
});
