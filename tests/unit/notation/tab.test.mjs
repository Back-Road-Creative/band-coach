import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTab } from '../../../src/notation/tab.js';

const GUITAR = [40, 45, 50, 55, 59, 64];
const BASS = [28, 33, 38, 43];

test('layoutTab: first note (no history) picks the lowest fret, open string when possible', () => {
  const { primitives } = layoutTab({ tuning: GUITAR, notes: [{ midi: 64, dur: 1 }] });
  assert.deepEqual(primitives[0], { type: 'fretNumber', string: 5, fret: 0, x: 10 });
});

test('layoutTab: on bass tuning, picks the lowest valid fret for the first note', () => {
  const { primitives } = layoutTab({ tuning: BASS, notes: [{ midi: 43, dur: 1 }] });
  assert.equal(primitives[0].fret, 0);
  assert.equal(primitives[0].string, 3);
});

test('layoutTab: with an ambiguous later note, stays close to the previous fret', () => {
  // maxFret 4 restricts the G-B string overlap (major third apart) so midi 59
  // is reachable both at string 3 fret 4 and string 4 fret 0.
  const { primitives } = layoutTab({
    tuning: GUITAR, maxFret: 4,
    notes: [{ midi: 44, dur: 1 }, { midi: 59, dur: 1 }],
  });
  assert.equal(primitives[0].fret, 4);
  assert.equal(primitives[1].string, 3);
  assert.equal(primitives[1].fret, 4, 'stays near the previous fret rather than jumping to the open string');
});

test('layoutTab: the same note in isolation (no previous fret) takes the open string instead', () => {
  const { primitives } = layoutTab({ tuning: GUITAR, maxFret: 4, notes: [{ midi: 59, dur: 1 }] });
  assert.equal(primitives[0].string, 4);
  assert.equal(primitives[0].fret, 0);
});

test('layoutTab: rests produce no fretNumber primitive', () => {
  const { primitives } = layoutTab({ tuning: GUITAR, notes: [{ midi: null, dur: 1 }, { midi: 64, dur: 1 }] });
  assert.equal(primitives.length, 1);
  assert.equal(primitives[0].x, 10 + 40);
});

test('layoutTab: an unplayable note (out of range) is skipped', () => {
  const { primitives } = layoutTab({ tuning: GUITAR, maxFret: 12, notes: [{ midi: 20, dur: 1 }] });
  assert.equal(primitives.length, 0);
});
