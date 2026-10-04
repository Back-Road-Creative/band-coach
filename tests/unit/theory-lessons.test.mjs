import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, levelCount } from '../../src/core/theory/lessons.js';
import { byId } from '../../src/instruments/index.js';
import { scale } from '../../src/core/theory/scales.js';
import { spellingToString } from '../../src/core/theory/pitch.js';

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

// Level 5 wrong choices must never be notes of the key (Eb in Ab major was
// graded wrong), and a level 5 question keeps its full set of choices.
test('level 5: exactly one choice is in the key, across every key and many seeds', () => {
  for (let seed = 0; seed < 400; seed++) {
    const q = make(5, seed, byId.gtr);
    const key = q.prompt.match(/in (\S+) major/)[1];
    const inKey = scale({ letter: key[0], accidental: key.slice(1) }, 'major').degrees.map(spellingToString);
    assert.equal(q.choices.length, 4, 'seed ' + seed + ' ' + key + ' choices ' + q.choices);
    assert.deepEqual(q.choices.filter(c => inKey.includes(c)), [q.answer], 'seed ' + seed + ' ' + key + ' choices ' + q.choices);
  }
});

// Level 4 on the generic Wind and brass trainer follows the B flat / E flat
// choice the app passes in as the record's transposition.
test('level 4 follows the transposition it is given (wind with a B flat choice)', () => {
  const bb = make(4, 7, Object.assign({}, byId.wind, { transposition: -2 }));
  const concert = make(4, 7, byId.wind);
  assert.notEqual(bb.answer, concert.answer);
});

test('level 2 prompts read like chord symbols and offer no triple accidentals as wrong answers', () => {
  for (let seed = 0; seed < 300; seed++) {
    const q = make(2, seed, byId.gtr);
    assert.match(q.prompt, /make up \S+\?$/, q.prompt);
    const wrong = q.choices.filter(c => c !== q.answer);
    for (const c of wrong) assert.doesNotMatch(c, /bbb|###/, q.prompt + ' ' + c);
  }
});

// Review fixes: the chord to build is never a triple-accidental spelling, and
// level 4 names the note (not a MIDI number) and is never a same-note question.
test('level 2 never asks for a chord whose answer has a triple accidental', () => {
  for (let seed = 0; seed < 3000; seed++) {
    const q = make(2, seed, byId.gtr);
    assert.doesNotMatch(q.answer, /bbb|###/, q.prompt + ' ' + q.answer);
  }
});

test('level 4 names the concert note and is not trivial on a concert-pitch instrument', () => {
  for (const id of ['gtr', 'flute', 'wind', 'trumpet-bb']) {
    for (let seed = 0; seed < 30; seed++) {
      const q = make(4, seed, byId[id]);
      assert.doesNotMatch(q.prompt, /MIDI|\d{2}\?/, q.prompt);
      assert.match(q.prompt, /concert-pitch [A-G][#b]?\d\?$/, q.prompt);
      const concert = q.prompt.match(/concert-pitch ([A-G][#b]?\d)\?$/)[1];
      if (!byId[id].transposition) assert.notEqual(q.answer, concert, id + ' ' + q.prompt);
    }
  }
});
