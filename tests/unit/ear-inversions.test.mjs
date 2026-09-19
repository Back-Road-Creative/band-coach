import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/inversions.js';

test('determinism - same level+seed gives the same question', () => {
  assert.deepEqual(make(3, 6), make(3, 6));
});

for (let level = 1; level <= LEVEL_COUNT; level++) {
  test(`level ${level} - answer is among choices, no duplicate choices`, () => {
    for (let seed = 0; seed < 15; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.ok(q.choices.includes(q.answer));
    }
  });
}

test('level ramp is monotonic - the chord-quality vocabulary never shrinks', () => {
  // Stated measure: distinct chord qualities seen across many seeds at that
  // level. The inversion count itself resets when level 4 moves from
  // triads to sevenths (a new, harder chord type starting from its own
  // simplest voicing), so quality count is the measure that only grows.
  let last = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const seen = new Set();
    for (let seed = 0; seed < 30; seed++) {
      seen.add(make(level, seed).prompt);
    }
    if (level === 4) continue; // triads -> sevenths swap, not a superset
    assert.ok(seen.size >= last, `level ${level} regressed: ${seen.size} < ${last}`);
    last = seen.size;
  }
});

test('level ramp is monotonic within a chord type - triad inversion range grows from level 1 to level 3', () => {
  const maxInversionSeen = (level) => {
    let max = 0;
    for (let seed = 0; seed < 30; seed++) {
      max = Math.max(max, make(level, seed).choices.length);
    }
    return max;
  };
  assert.ok(maxInversionSeen(1) <= maxInversionSeen(2));
  assert.ok(maxInversionSeen(2) <= maxInversionSeen(3));
  assert.ok(maxInversionSeen(4) <= maxInversionSeen(5));
});

test('level 1 is always root position', () => {
  for (let seed = 0; seed < 10; seed++) {
    assert.equal(make(1, seed).answer, 'root position');
  }
});

test('root position voices the chord as literal root+intervals', () => {
  let found = null;
  for (let seed = 0; seed < 50 && !found; seed++) {
    const q = make(3, seed);
    if (q.answer === 'root position' && q.explain.includes('major,')) found = q;
  }
  assert.ok(found);
  const root = found.play[0].midi[0];
  assert.deepEqual(found.play[0].midi, [root, root + 4, root + 7]);
});

test('1st inversion puts the third in the bass (lowest note is 4 or 3 semitones above some absent root)', () => {
  let found = null;
  for (let seed = 0; seed < 50 && !found; seed++) {
    const q = make(3, seed);
    if (q.answer === '1st inversion' && q.explain.includes('major,')) found = q;
  }
  assert.ok(found, 'expected a level-3 major 1st-inversion question within 50 seeds');
  const [bass, mid, top] = found.play[0].midi;
  assert.equal(mid - bass, 3); // major third's complement up to the octave root
  assert.equal(top - mid, 5);
});

test('check(): correct inversion name is ok, wrong one is not', () => {
  const q = make(3, 2);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, 'nonsense').ok, false);
});
