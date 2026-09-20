import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDS_TOGETHER_EXERCISES,
  handsTogetherById,
  fingeringLabel,
  gradeHandsTogetherExact,
  gradeHandsTogetherApprox
} from '../../src/core/hands-together.js';

test('curriculum: five exercises, standard C-position fingering, LH mirrors RH an octave down', () => {
  assert.equal(HANDS_TOGETHER_EXERCISES.length, 5);
  const byName = {};
  HANDS_TOGETHER_EXERCISES.forEach(e => { byName[e.name] = e; });
  // Right hand: thumb-on-C five-finger position, fingers 1-2-3-4-5 on C-D-E-F-G.
  assert.deepEqual(byName.C.rh, { midi: 60, finger: 1 });
  assert.deepEqual(byName.D.rh, { midi: 62, finger: 2 });
  assert.deepEqual(byName.E.rh, { midi: 64, finger: 3 });
  assert.deepEqual(byName.F.rh, { midi: 65, finger: 4 });
  assert.deepEqual(byName.G.rh, { midi: 67, finger: 5 });
  // Left hand: same letter names an octave down, fingers 5-4-3-2-1.
  assert.deepEqual(byName.C.lh, { midi: 48, finger: 5 });
  assert.deepEqual(byName.D.lh, { midi: 50, finger: 4 });
  assert.deepEqual(byName.E.lh, { midi: 52, finger: 3 });
  assert.deepEqual(byName.F.lh, { midi: 53, finger: 2 });
  assert.deepEqual(byName.G.lh, { midi: 55, finger: 1 });
  // Every id is unique and matches the 'j<n>' scheme app.js's info()/validId() expect.
  const ids = HANDS_TOGETHER_EXERCISES.map(e => e.id);
  assert.deepEqual(ids, ['j1', 'j2', 'j3', 'j4', 'j5']);
});

test('handsTogetherById finds a real exercise and returns null for an unknown id', () => {
  const ex = handsTogetherById('j1');
  assert.equal(ex.name, 'C');
  assert.equal(handsTogetherById('j99'), null);
  assert.equal(handsTogetherById('nope'), null);
});

test('fingeringLabel names both hands plain-language', () => {
  const ex = handsTogetherById('j1');
  assert.equal(fingeringLabel(ex), 'right hand finger 1, left hand finger 5');
});

test('gradeHandsTogetherExact: both correct notes held, nothing else -> ok', () => {
  const ex = handsTogetherById('j1'); // rh 60, lh 48
  const g = gradeHandsTogetherExact(ex, [60, 48]);
  assert.equal(g.ok, true);
  assert.equal(g.rh, true);
  assert.equal(g.lh, true);
  assert.deepEqual(g.wrong, []);
});

test('gradeHandsTogetherExact: order of the two notes does not matter', () => {
  const ex = handsTogetherById('j1');
  const g = gradeHandsTogetherExact(ex, [48, 60]);
  assert.equal(g.ok, true);
});

test('gradeHandsTogetherExact: only one hand held -> not ok, reports which hand is missing', () => {
  const ex = handsTogetherById('j1');
  const rhOnly = gradeHandsTogetherExact(ex, [60]);
  assert.equal(rhOnly.ok, false);
  assert.equal(rhOnly.rh, true);
  assert.equal(rhOnly.lh, false);

  const lhOnly = gradeHandsTogetherExact(ex, [48]);
  assert.equal(lhOnly.ok, false);
  assert.equal(lhOnly.rh, false);
  assert.equal(lhOnly.lh, true);
});

test('gradeHandsTogetherExact: an extra wrong note held alongside both correct ones -> not ok', () => {
  const ex = handsTogetherById('j1');
  const g = gradeHandsTogetherExact(ex, [60, 48, 61]);
  assert.equal(g.ok, false);
  assert.deepEqual(g.wrong, [61]);
});

test('gradeHandsTogetherExact: empty input -> not ok, neither hand', () => {
  const ex = handsTogetherById('j1');
  const g = gradeHandsTogetherExact(ex, []);
  assert.equal(g.ok, false);
  assert.equal(g.rh, false);
  assert.equal(g.lh, false);
});

test('gradeHandsTogetherApprox: a single detected pitch can confirm at most one hand, never both', () => {
  const ex = handsTogetherById('j1'); // rh 60, lh 48
  const rh = gradeHandsTogetherApprox(ex, 60);
  assert.equal(rh.ok, true);
  assert.equal(rh.hand, 'rh');

  const lh = gradeHandsTogetherApprox(ex, 48);
  assert.equal(lh.ok, true);
  assert.equal(lh.hand, 'lh');

  const neither = gradeHandsTogetherApprox(ex, 61);
  assert.equal(neither.ok, false);
  assert.equal(neither.hand, null);
});
