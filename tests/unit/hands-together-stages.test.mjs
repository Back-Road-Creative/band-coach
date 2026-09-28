// Levels 15-16 ("held bass under the melody" / "different rhythms in each
// hand"): pure logic added alongside level 14's timed pair. See
// tests/characterization/kbd-levels-15-16.test.mjs for the real-MIDI
// walk-throughs and tests/unit/hands-together-timed.test.mjs for level 14's
// own precedent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handsTogetherById,
  handsModeFromId,
  handsStageFromId,
  isStagedPairId,
  isTimedPairId,
  bothUnlocked,
  heldBassMelody,
  gradeHeldBass,
  gradeSplitRhythm,
  SPLIT_MID_TOL_RATIO,
  PAIR_RELEASE_TOL_MS,
  HANDS_TOGETHER_EXERCISES
} from '../../src/core/hands-together.js';

test('h/d ids are recognised; x is still not', () => {
  assert.notEqual(handsTogetherById('j1h'), null);
  assert.notEqual(handsTogetherById('j1d'), null);
  assert.equal(handsTogetherById('j1x'), null);
});

test('handsModeFromId reports both for a held/split id', () => {
  assert.equal(handsModeFromId('j2h'), 'both');
  assert.equal(handsModeFromId('j2d'), 'both');
});

test('isTimedPairId is false for h/d ids; isStagedPairId is true for t/h/d and false for plain/r/l', () => {
  assert.equal(isTimedPairId('j1h'), false);
  assert.equal(isTimedPairId('j1d'), false);
  assert.equal(isStagedPairId('j1t'), true);
  assert.equal(isStagedPairId('j1h'), true);
  assert.equal(isStagedPairId('j1d'), true);
  assert.equal(isStagedPairId('j1'), false);
  assert.equal(isStagedPairId('j1r'), false);
  assert.equal(isStagedPairId('j1l'), false);
});

test('handsStageFromId names each stage, and null for an invalid id', () => {
  assert.equal(handsStageFromId('j1'), 'plain');
  assert.equal(handsStageFromId('j1r'), 'plain');
  assert.equal(handsStageFromId('j1l'), 'plain');
  assert.equal(handsStageFromId('j1t'), 'timed');
  assert.equal(handsStageFromId('j1h'), 'held');
  assert.equal(handsStageFromId('j1d'), 'split');
  assert.equal(handsStageFromId('j1x'), null);
});

test('bothUnlocked ignores held/split item records', () => {
  assert.equal(bothUnlocked({ item: { j1h: { seen: 3, reps: 2 }, j1d: { seen: 3, reps: 2 } } }), false);
});

test('heldBassMelody: j1 (C) plays [C, D, C]; j5 (G, the top pair) plays [G, F, G]', () => {
  const j1 = handsTogetherById('j1'), j5 = handsTogetherById('j5');
  assert.deepEqual(heldBassMelody(j1).map((n) => n.midi), [60, 62, 60]);
  assert.deepEqual(heldBassMelody(j5).map((n) => n.midi), [67, 65, 67]);
});

const ex1 = HANDS_TOGETHER_EXERCISES[0]; // C: rh 60, lh 48
const melody1 = heldBassMelody(ex1); // [60, 62, 60]

test('gradeHeldBass: waiting with no melody notes yet', () => {
  const r = gradeHeldBass(ex1, { notes: [] });
  assert.equal(r.state, 'waiting');
});

test('gradeHeldBass: a melody note played while the bass was not held fails with a hold reason', () => {
  const r = gradeHeldBass(ex1, { notes: [{ midi: 60, ms: 1000, bassHeld: false }] });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /left hand/i);
  assert.match(r.reason, /hold/i);
});

test('gradeHeldBass: a wrong melody note fails, naming the expected note', () => {
  const r = gradeHeldBass(ex1, { notes: [{ midi: 64, ms: 1000, bassHeld: true }] });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /not the next melody note/i);
});

test('gradeHeldBass: the bass released before the melody finished fails with the hold reason', () => {
  const r = gradeHeldBass(ex1, {
    bassOff: 1050,
    notes: [{ midi: 60, ms: 1000, bassHeld: true }]
  });
  assert.equal(r.state, 'fail');
  assert.match(r.reason, /left hand/i);
  assert.match(r.reason, /hold/i);
});

test('gradeHeldBass: waiting once all three melody notes match but the bass has not been released yet', () => {
  const r = gradeHeldBass(ex1, {
    notes: [
      { midi: 60, ms: 1000, bassHeld: true },
      { midi: 62, ms: 1200, bassHeld: true },
      { midi: 60, ms: 1400, bassHeld: true }
    ]
  });
  assert.equal(r.state, 'waiting');
});

test('gradeHeldBass: passes once the bass note-off comes after the last melody note-on', () => {
  const r = gradeHeldBass(ex1, {
    bassOff: 1500,
    notes: [
      { midi: 60, ms: 1000, bassHeld: true },
      { midi: 62, ms: 1200, bassHeld: true },
      { midi: 60, ms: 1400, bassHeld: true }
    ]
  });
  assert.equal(r.state, 'pass');
});

const ex = HANDS_TOGETHER_EXERCISES[0]; // rh 60, lh 48

test('gradeSplitRhythm: left hand 200ms late gives lh fail, rh not fail', () => {
  const r = gradeSplitRhythm(ex, { lhOn: 1200, lhOff: 2000, rhOns: [1000], rhOffs: [] });
  assert.equal(r.lh.state, 'fail');
  assert.notEqual(r.rh.state, 'fail');
});

test('gradeSplitRhythm: a second right-hand onset far from the left-hand midpoint gives rh fail, lh pass', () => {
  const r = gradeSplitRhythm(ex, { lhOn: 1000, lhOff: 2000, rhOns: [1010, 1900], rhOffs: [1300, 2010] });
  assert.equal(r.rh.state, 'fail');
  assert.equal(r.lh.state, 'pass');
});

test('gradeSplitRhythm: on-time input passes both hands', () => {
  const lhOn = 1000, lhOff = 2000, mid = (lhOn + lhOff) / 2;
  const r = gradeSplitRhythm(ex, { lhOn: lhOn, lhOff: lhOff, rhOns: [1010, mid], rhOffs: [1300, 2010] });
  assert.equal(r.lh.state, 'pass');
  assert.equal(r.rh.state, 'pass');
  assert.equal(r.state, 'pass');
});

test('SPLIT_MID_TOL_RATIO is 0.2, and the right-hand tolerance is max(PAIR_RELEASE_TOL_MS, ratio * held length)', () => {
  assert.equal(SPLIT_MID_TOL_RATIO, 0.2);
  const lhOn = 1000, lhOff = 5000; // 4000ms held -> ratio tol = 800 > PAIR_RELEASE_TOL_MS
  const mid = (lhOn + lhOff) / 2;
  const justInside = gradeSplitRhythm(ex, { lhOn: lhOn, lhOff: lhOff, rhOns: [1010, mid + 750], rhOffs: [1300, 5010] });
  assert.notEqual(justInside.rh.state, 'fail');
  const justOutside = gradeSplitRhythm(ex, { lhOn: lhOn, lhOff: lhOff, rhOns: [1010, mid + 850], rhOffs: [1300, 5010] });
  assert.equal(justOutside.rh.state, 'fail');
  assert.ok(SPLIT_MID_TOL_RATIO * (lhOff - lhOn) > PAIR_RELEASE_TOL_MS);
});

test('the right-hand tolerance floors at PAIR_RELEASE_TOL_MS on a short held note', () => {
  const lhOn = 1000, lhOff = 1500; // 500ms held -> ratio tol = 100 < PAIR_RELEASE_TOL_MS (150), so the floor applies
  const mid = (lhOn + lhOff) / 2;
  assert.ok(SPLIT_MID_TOL_RATIO * (lhOff - lhOn) < PAIR_RELEASE_TOL_MS);
  const justInside = gradeSplitRhythm(ex, { lhOn: lhOn, lhOff: lhOff, rhOns: [1010, mid + 140], rhOffs: [1300, 1510] });
  assert.notEqual(justInside.rh.state, 'fail');
  const justOutside = gradeSplitRhythm(ex, { lhOn: lhOn, lhOff: lhOff, rhOns: [1010, mid + 160], rhOffs: [1300, 1510] });
  assert.equal(justOutside.rh.state, 'fail');
});

test('gradeSplitRhythm: a third right-hand onset fails, naming the right hand', () => {
  const r = gradeSplitRhythm(ex, { lhOn: 0, lhOff: 1000, rhOns: [0, 500, 950], rhOffs: [400, 900, 990] });
  assert.equal(r.rh.state, 'fail');
  assert.match(r.rh.reason, /right hand/i);
  assert.equal(r.state, 'fail');
});

test('gradeSplitRhythm: a left hand still held (no lhOff) is never failed on the release rules', () => {
  // The app resets rhOns/rhOffs to [] on a fail but only e.pair.on/off for the
  // held-note timestamps -- this asserts the PURE grader treats a fresh lhOn
  // with no matching lhOff as still-held (undefined off), not the old value.
  const stale = gradeSplitRhythm(ex, { lhOn: 1000, lhOff: undefined, rhOns: [1000, 1500], rhOffs: [1400] });
  assert.notEqual(stale.lh.state, 'fail');
  assert.notEqual(stale.rh.state, 'fail');
});
