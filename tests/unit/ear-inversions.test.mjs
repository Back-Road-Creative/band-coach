import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT } from '../../src/core/ear/inversions.js';

test('determinism, choice invariants, and a monotonic quality/inversion ramp', () => {
  assert.deepEqual(make(3, 6), make(3, 6));
  let lastQualities = 0;
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const seenPrompts = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const q = make(level, seed);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.ok(q.choices.includes(q.answer));
      seenPrompts.add(q.prompt); // one prompt per distinct chord quality
    }
    if (level !== 4) {
      // triads -> sevenths at level 4 legitimately swaps vocabulary, not a superset
      assert.ok(seenPrompts.size >= lastQualities, `level ${level} regressed`);
      lastQualities = seenPrompts.size;
    }
  }
  // Within a chord type the inversion range only grows: 1 (levels 1-3) then 2 (4-5).
  const maxChoices = (level) => Math.max(...Array.from({ length: 30 }, (_, s) => make(level, s).choices.length));
  assert.ok(maxChoices(1) <= maxChoices(2) && maxChoices(2) <= maxChoices(3));
  assert.ok(maxChoices(4) <= maxChoices(5));
});

test('level 1 is always root position, voiced as a plain major or minor triad', () => {
  for (let seed = 0; seed < 10; seed++) {
    const q = make(1, seed);
    assert.equal(q.answer, 'root position');
    const [r, third, fifth] = q.play[0].midi;
    assert.ok([3, 4].includes(third - r));
    assert.equal(fifth - r, 7);
  }
});

test('1st inversion puts the third in the bass', () => {
  let found = null;
  for (let seed = 0; seed < 50 && !found; seed++) {
    const q = make(3, seed);
    if (q.answer === '1st inversion' && q.explain.includes('major,')) found = q;
  }
  assert.ok(found, 'expected a level-3 major 1st-inversion question within 50 seeds');
  const [bass, mid, top] = found.play[0].midi;
  assert.equal(mid - bass, 3);
  assert.equal(top - mid, 5);
});

test('check(): correct/wrong inversion names are graded correctly', () => {
  const q = make(3, 2);
  assert.equal(check(q, q.answer).ok, true);
  assert.equal(check(q, 'nonsense').ok, false);
});
