import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/melodic-dictation.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(3, 8), make(3, 8));
});

test('choices are always empty (free response) - never duplicates by construction', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    assert.deepEqual(make(level, 0).choices, []);
  }
});

test('level ramp is monotonic - note count never decreases', () => {
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const n = make(level, 0).answer.length;
    assert.ok(n >= last, `level ${level} regressed`);
    last = n;
  }
});

test('note count is within the 3-8 spec range at every level', () => {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const n = make(level, 0).answer.length;
    assert.ok(n >= 3 && n <= 8, `level ${level} had ${n} notes`);
  }
});

test('level 1-2 phrases move stepwise only (at most a whole tone between notes)', () => {
  for (const level of [1, 2]) {
    for (let seed = 0; seed < 10; seed++) {
      const midi = make(level, seed).answer;
      for (let i = 1; i < midi.length; i++) {
        assert.ok(Math.abs(midi[i] - midi[i - 1]) <= 2, `level ${level} seed ${seed} had a leap`);
      }
    }
  }
});

test('higher levels allow wider leaps than level 1-2', () => {
  const maxLeap = (level) => {
    let max = 0;
    for (let seed = 0; seed < 20; seed++) {
      const midi = make(level, seed).answer;
      for (let i = 1; i < midi.length; i++) max = Math.max(max, Math.abs(midi[i] - midi[i - 1]));
    }
    return max;
  };
  assert.ok(maxLeap(5) > maxLeap(1));
});

test('every phrase stays diatonic to a major scale', () => {
  const MAJOR_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 10; seed++) {
      const q = make(level, seed);
      const tonicMatch = /Key: ([A-G]#?) major/.exec(q.explain);
      assert.ok(tonicMatch, q.explain);
      const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const tonicPc = NOTE_NAMES.indexOf(tonicMatch[1]);
      q.answer.forEach((m) => {
        const relPc = ((m - tonicPc) % 12 + 12) % 12;
        assert.ok(MAJOR_PCS.has(relPc), `note ${m} not diatonic in level ${level} seed ${seed}`);
      });
    }
  }
});

test('check(): exact match is ok', () => {
  const q = make(2, 5);
  assert.equal(check(q, q.answer).ok, true);
});

test('check(): reports each wrong note by index', () => {
  const q = make(1, 0);
  const bad = q.answer.slice();
  bad[0] += 5;
  const result = check(q, bad);
  assert.equal(result.ok, false);
  assert.equal(result.detail.wrong[0].index, 0);
});

test('check(): foldOctave accepts a response transposed by an octave', () => {
  const q = make(1, 0);
  const upAnOctave = q.answer.map((m) => m + 12);
  assert.equal(check(q, upAnOctave, { foldOctave: true }).ok, true);
  assert.equal(check(q, upAnOctave, { foldOctave: false }).ok, false);
});

test('check(): a short response is not ok', () => {
  const q = make(2, 0);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
});
