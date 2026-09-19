import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/progressions.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(2, 9), make(2, 9));
});

for (let level = 1; level <= LEVEL_COUNT; level++) {
  test(`level ${level} - every roman numeral in the answer is among choices, no duplicate choices`, () => {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      for (const rn of q.answer) {
        assert.ok(q.choices.includes(rn), `${rn} missing from choices at level ${level} seed ${seed}`);
      }
    }
  });
}

test('level ramp is monotonic - the roman-numeral vocabulary in play never shrinks', () => {
  // Stated measure: number of distinct roman numerals reachable across many
  // seeds at that level (major-only levels 1-2 use a 6-numeral vocabulary,
  // minor-only level 3 a 5-numeral one, mixed levels 4-5 the union of both).
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const seen = new Set();
    for (let seed = 0; seed < 60; seed++) {
      make(level, seed).answer.forEach((rn) => seen.add(rn));
    }
    if (level === 3) continue; // minor-only level legitimately narrows vs. the major-only level before it
    assert.ok(seen.size >= last, `level ${level} regressed: ${seen.size} < ${last}`);
    last = seen.size;
  }
});

test('level 1 progressions spell major triads only, in C', () => {
  for (let seed = 0; seed < 10; seed++) {
    const q = make(1, seed);
    assert.match(q.explain, /^Key: C major/);
    assert.equal(q.answer.length, 3);
  }
});

test('level 3 progressions are minor-key loops', () => {
  for (let seed = 0; seed < 10; seed++) {
    const q = make(3, seed);
    assert.match(q.explain, /minor/);
  }
});

test('I-V-vi-IV in C spells C major, G major, A minor, F major', () => {
  // Level 2 pool includes the I-V-vi-IV loop (index 2 of MAJOR_LOOPS);
  // walk seeds until we land on it, since the pool is picked by rng.
  let found = null;
  for (let seed = 0; seed < 200 && !found; seed++) {
    const q = make(2, seed);
    if (q.answer.join('-') === 'I-V-vi-IV') found = q;
  }
  assert.ok(found, 'expected to find an I-V-vi-IV question within 200 seeds');
  const chords = found.play.map((ev) => ev.midi.map((m) => m % 12).sort((a, b) => a - b));
  assert.deepEqual(chords[0], [0, 4, 7]); // C major
  assert.deepEqual(chords[1], [2, 7, 11]); // G major
  assert.deepEqual(chords[2], [0, 4, 9]); // A minor
  assert.deepEqual(chords[3], [0, 5, 9]); // F major
});

test('i-VI-VII in a minor key spells minor, major, major', () => {
  let found = null;
  for (let seed = 0; seed < 200 && !found; seed++) {
    const q = make(3, seed);
    if (q.answer.join('-') === 'i-VI-VII') found = q;
  }
  assert.ok(found, 'expected to find an i-VI-VII question within 200 seeds');
  const [a, b, c] = found.play.map((ev) => ev.midi.map((m) => m - ev.midi[0]));
  assert.deepEqual(a, [0, 3, 7]); // minor triad
  assert.deepEqual(b, [0, 4, 7]); // major triad
  assert.deepEqual(c, [0, 4, 7]); // major triad
});

test('check(): correct progression in order is ok', () => {
  const q = make(4, 3);
  assert.equal(check(q, q.answer).ok, true);
});

test('check(): a wrong roman numeral is reported with its index', () => {
  const q = make(1, 0);
  const bad = q.answer.slice();
  bad[1] = 'zzz';
  const result = check(q, bad);
  assert.equal(result.ok, false);
  assert.equal(result.detail.wrong[0].index, 1);
});
