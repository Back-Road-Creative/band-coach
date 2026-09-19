import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemIdForMidi, mapMasteryKeys } from '../../src/ui/songs/mastery.js';

test('kbd maps a midi note straight to n<midi> when in range', () => {
  assert.equal(itemIdForMidi('kbd', 60, {}), 'n60');
});

test('kbd folds an out-of-range note into the drill range 48-72', () => {
  assert.equal(itemIdForMidi('kbd', 36, {}), 'n48');
  assert.equal(itemIdForMidi('kbd', 84, {}), 'n72');
});

test('gtr/bass/uke map to a pitch-class item, any octave', () => {
  assert.equal(itemIdForMidi('gtr', 64, {}), 'p4');
  assert.equal(itemIdForMidi('bass', 40, {}), 'p4');
  assert.equal(itemIdForMidi('uke', 76, {}), 'p4');
});

test('voice maps to a scale degree from the preferred tonic', () => {
  assert.equal(itemIdForMidi('voice', 48, { voice: 'low' }), 'v0'); // low Do = C3 = 48
  assert.equal(itemIdForMidi('voice', 55, { voice: 'mid' }), 'v0'); // mid Do = G3 = 55
  assert.equal(itemIdForMidi('voice', 62, { voice: 'mid' }), 'v7'); // a fifth above mid Do
  assert.equal(itemIdForMidi('voice', 48, {}), 'v0'); // default preference is 'low'
});

test('wind maps a concert-pitch midi note to the written item for the chosen transposition', () => {
  // B-flat trumpet (default): written = concert + 2.
  assert.equal(itemIdForMidi('wind', 60, { wind: 'bb' }), 'w62');
  assert.equal(itemIdForMidi('wind', 60, {}), 'w62'); // default preference is 'bb'
  // Bass-clef trombone: written = concert + 19.
  assert.equal(itemIdForMidi('wind', 41, { wind: 'bc' }), 'w60');
});

test('harp maps a concert pitch to the first matching hole in search order 4,5,6,7,3,2,1,8,9,10, blow before draw', () => {
  // pitch class 0 (C): hole 4 blow is C5=72 (pc 0) -- the first hit in
  // search order, even though hole 1 blow (C4=60) is also pc 0.
  assert.equal(itemIdForMidi('harp', 60, {}), 'hb4');
  // pitch class 2 (D): hole 4 blow (pc 0) misses, hole 4 draw is E5=74 (pc 2).
  assert.equal(itemIdForMidi('harp', 62, {}), 'hd4');
  // pitch class 7 (G): hole 4/5 (blow+draw) miss, hole 6 blow is G5=79 (pc 7).
  assert.equal(itemIdForMidi('harp', 67, {}), 'hb6');
});

test('planned instruments with no drill curriculum return null', () => {
  assert.equal(itemIdForMidi('violin', 60, {}), null);
  assert.equal(itemIdForMidi('trumpet-bb', 60, {}), null);
  assert.equal(itemIdForMidi('nonexistent-instrument', 60, {}), null);
});

test('mapMasteryKeys converts creditFor()-shaped keys and drops unmapped ones', () => {
  const masteryKeys = [
    { key: 'midi:60', hit: true },
    { key: 'midi:64', hit: false },
  ];
  assert.deepEqual(mapMasteryKeys(masteryKeys, 'kbd', {}), [
    { id: 'n60', hit: true },
    { id: 'n64', hit: false },
  ]);
  assert.deepEqual(mapMasteryKeys(masteryKeys, 'violin', {}), []);
});
