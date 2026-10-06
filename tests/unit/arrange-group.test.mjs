// groupByStart (src/song/arrange/group.js): the chord-grouping step fretted.js
// and keys.js share. Notes that start on the same tick become one entry, each
// keeping its index in the input, and groups come back in time order.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupByStart } from '../../src/song/arrange/group.js';

test('no notes gives no groups', () => {
  assert.deepEqual(groupByStart([]), []);
});

test('notes that share a start tick become one chord, in input order, with their input indices', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 0, dur: 480, midi: 64 },
    { start: 0, dur: 240, midi: 67 },
  ];
  const groups = groupByStart(notes);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].start, 0);
  assert.deepEqual(groups[0].entries.map((e) => e.index), [0, 1, 2]);
  assert.deepEqual(groups[0].entries.map((e) => e.note.midi), [60, 64, 67]);
  assert.equal(groups[0].entries[1].note, notes[1], 'the entry holds the very same note object');
});

test('groups come back sorted by start even when the input is not, and indices still point at the input', () => {
  const notes = [
    { start: 960, dur: 480, midi: 65 },
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 62 },
    { start: 960, dur: 480, midi: 69 },
  ];
  const groups = groupByStart(notes);
  assert.deepEqual(groups.map((g) => g.start), [0, 480, 960]);
  assert.deepEqual(groups.map((g) => g.entries.map((e) => e.index)), [[1], [2], [0, 3]]);
});

test('the sort is numeric, not alphabetical (tick 1000 comes after tick 200)', () => {
  const groups = groupByStart([{ start: 1000, dur: 1, midi: 60 }, { start: 200, dur: 1, midi: 62 }, { start: 30, dur: 1, midi: 64 }]);
  assert.deepEqual(groups.map((g) => g.start), [30, 200, 1000]);
});

test('the input array is left untouched', () => {
  const notes = [{ start: 480, dur: 480, midi: 62 }, { start: 0, dur: 480, midi: 60 }];
  const snapshot = JSON.stringify(notes);
  groupByStart(notes);
  assert.equal(JSON.stringify(notes), snapshot);
});
