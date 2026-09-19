import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/progressions.js';

test('determinism, choice invariants, and a monotonic roman-numeral vocabulary', () => {
  assert.deepEqual(make(2, 9), make(2, 9));
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const seen = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      q.answer.forEach((rn) => {
        assert.ok(q.choices.includes(rn), `${rn} missing from choices at level ${level}`);
        seen.add(rn);
      });
    }
    if (level === 3) continue; // minor-only level legitimately narrows vs. the major-only level before it
    assert.ok(seen.size >= last, `level ${level} regressed`);
    last = seen.size;
  }
});

test('level 1 is C major triads only; level 3 is minor-key loops', () => {
  for (let seed = 0; seed < 10; seed++) {
    const q1 = make(1, seed);
    assert.match(q1.explain, /^Key: C major/);
    assert.equal(q1.answer.length, 3);
    assert.match(make(3, seed).explain, /minor/);
  }
});

function findLoop(level, roman) {
  for (let seed = 0; seed < 200; seed++) {
    const q = make(level, seed);
    if (q.answer.join('-') === roman) return q;
  }
  return null;
}

test('progressions spell the right chords in two keys', () => {
  const major = findLoop(2, 'I-V-vi-IV');
  assert.ok(major, 'expected an I-V-vi-IV question within 200 seeds');
  const majorChords = major.play.map((ev) => ev.midi.map((m) => m % 12).sort((a, b) => a - b));
  assert.deepEqual(majorChords, [[0, 4, 7], [2, 7, 11], [0, 4, 9], [0, 5, 9]]); // C, G, Am, F

  const minor = findLoop(3, 'i-VI-VII');
  assert.ok(minor, 'expected an i-VI-VII question within 200 seeds');
  const minorRel = minor.play.map((ev) => ev.midi.map((m) => m - ev.midi[0]));
  assert.deepEqual(minorRel, [[0, 3, 7], [0, 4, 7], [0, 4, 7]]); // minor, major, major
});

test('check(): correct/wrong progressions are graded correctly', () => {
  const good = make(4, 3);
  assert.equal(check(good, good.answer).ok, true);
  const q = make(1, 0);
  const bad = q.answer.slice();
  bad[1] = 'zzz';
  const result = check(q, bad);
  assert.equal(result.ok, false);
  assert.equal(result.detail.wrong[0].index, 1);
});
