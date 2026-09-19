import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, levelCount } from '../../src/core/theory/lessons.js';
import { byId } from '../../src/instruments/index.js';

test('make() is deterministic: same level+seed(+instrument) always returns the same question', () => {
  for (let level = 1; level <= levelCount(); level++) {
    const a = make(level, 12345, byId.gtr);
    const b = make(level, 12345, byId.gtr);
    assert.deepEqual(a, b, 'level ' + level + ' was not deterministic');
  }
});

test('a different seed changes the question (at least sometimes)', () => {
  let changedSomewhere = false;
  for (let level = 1; level <= levelCount(); level++) {
    const a = make(level, 1, byId.gtr);
    const b = make(level, 2, byId.gtr);
    if (JSON.stringify(a) !== JSON.stringify(b)) changedSomewhere = true;
  }
  assert.ok(changedSomewhere);
});

test('a different instrument can change the question (transpose question is instrument-specific)', () => {
  const trumpet = make(4, 7, byId['trumpet-bb']);
  const sax = make(4, 7, byId['sax-alto-eb']);
  assert.notEqual(trumpet.prompt, sax.prompt);
});

test('every generated question has its answer among its choices, with no duplicate choices', () => {
  const seeds = [0, 1, 2, 3, 99, 100000];
  for (let level = 1; level <= levelCount(); level++) {
    for (const seed of seeds) {
      const q = make(level, seed, byId.gtr);
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 2, 'level ' + level + ' seed ' + seed + ' needs >=2 choices');
      assert.ok(q.choices.includes(q.answer), 'level ' + level + ' seed ' + seed + ' answer missing from choices');
      assert.equal(new Set(q.choices).size, q.choices.length, 'level ' + level + ' seed ' + seed + ' has duplicate choices');
      assert.equal(typeof q.id, 'string');
      assert.equal(typeof q.prompt, 'string');
      assert.equal(typeof q.explain, 'string');
    }
  }
});

test('check() grades a response against the question answer', () => {
  const q = make(1, 5, byId.gtr);
  assert.equal(check(q, q.answer), true);
  const wrong = q.choices.find(c => c !== q.answer);
  assert.equal(check(q, wrong), false);
});

test('an out-of-range level clamps to the last level instead of throwing', () => {
  assert.doesNotThrow(() => make(999, 1, byId.gtr));
  assert.doesNotThrow(() => make(0, 1, byId.gtr));
});
