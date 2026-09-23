import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA, TICKS_PER_QUARTER, barsOf, notesInBar, songDurationTicks
} from '../../src/song/model.js';

// Mirrors the baseSong() shape used in tests/unit/song-model.test.mjs, but
// kept local so this file's metreChanges cases stay self-contained.
function baseSong(overrides = {}) {
  return {
    schema: SCHEMA, id: 'twinkle', title: 'Twinkle Twinkle', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 60 }, { start: 960, dur: 480, midi: 67 }
    ] }],
    chords: [{ start: 0, symbol: 'C' }],
    ...overrides
  };
}

test('barsOf without metreChanges is unaffected (byte-identical to plain metre)', () => {
  assert.deepEqual(barsOf(baseSong()), [0, 1920]);
  assert.deepEqual(barsOf(baseSong({ metre: { num: 6, den: 8 } })), [0, 1440]);
  assert.deepEqual(barsOf(baseSong({ parts: [{ id: 'p', name: 'P', notes: [] }] })), [0, 1920]);
});

test('barsOf inserts a bar boundary exactly at a mid-song metre change tick', () => {
  // 4/4 (1920 ticks/bar) until tick 3840 (2 full bars), then 3/4 (1440 ticks/bar).
  // Notes reach out to 6440, one full 3/4 bar past the change.
  const song = baseSong({
    metre: { num: 4, den: 4 },
    metreChanges: [{ tick: 3840, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 6000, dur: 440, midi: 67 }
    ] }]
  });
  assert.equal(songDurationTicks(song), 6440);
  assert.deepEqual(barsOf(song), [0, 1920, 3840, 5280, 6720]);
});

test('barsOf shortens the bar straddling the change so the boundary lands exactly on the change tick', () => {
  // Metre changes at tick 5000, mid-way through what would have been the
  // third 4/4 bar (3840-5760); that bar is truncated to end at 5000.
  const song = baseSong({
    metre: { num: 4, den: 4 },
    metreChanges: [{ tick: 5000, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 6900, dur: 100, midi: 67 }
    ] }]
  });
  assert.deepEqual(barsOf(song), [0, 1920, 3840, 5000, 6440, 7880]);
});

test('barsOf honors a metreChanges entry at tick 0, overriding song.metre', () => {
  const song = baseSong({
    metre: { num: 4, den: 4 },
    metreChanges: [{ tick: 0, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 100, midi: 60 }] }]
  });
  assert.deepEqual(barsOf(song), [0, 1440]);
});

test('barsOf handles multiple metre changes across a song', () => {
  const song = baseSong({
    metre: { num: 4, den: 4 },
    metreChanges: [
      { tick: 1920, num: 3, den: 4 },  // one 4/4 bar, then 3/4 (1440/bar)
      { tick: 4800, num: 2, den: 4 }   // two 3/4 bars (1920-4800), then 2/4 (960/bar)
    ],
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 5700, dur: 1, midi: 60 }] }]
  });
  assert.deepEqual(songDurationTicks(song), 5701);
  assert.deepEqual(barsOf(song), [0, 1920, 3360, 4800, 5760]);
});

test('notesInBar uses the same bar windows as barsOf across a metre change', () => {
  // 4/4 until 3840, then 3/4: bar 2 is [3840, 5280), bar 3 is [5280, 6720).
  // The fixed-metre math put bar 3 at [5760, 7680) and missed the note at 5400.
  const song = baseSong({
    metreChanges: [{ tick: 3840, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 5000, dur: 240, midi: 62 },
      { start: 5400, dur: 240, midi: 64 }, { start: 6000, dur: 440, midi: 67 }
    ] }]
  });
  const starts = (b) => notesInBar(song, b).map(({ note }) => note.start);
  assert.deepEqual(starts(2), [5000]);
  assert.deepEqual(starts(3), [5400, 6000]);
  assert.deepEqual(starts(4), []);
});

// A bar length of zero (or NaN) must never be allowed to loop forever inside
// barsOf's `while (tick < duration ...)` loop. Without the guard these three
// cases hang the process rather than throwing, so this file hangs and the
// containing `node --test` run times out (exit 124) instead of failing fast.
// See tests/unit/song-model.test.mjs for the same guard exercised in a
// child process, in case a future regression reintroduces the infinite loop.

test('barsOf throws rather than looping forever on a zero-length opening metre', () => {
  const song = baseSong({
    metre: { num: 0, den: 4 },
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60 }] }]
  });
  assert.throws(() => barsOf(song), /bar must be longer than zero ticks/);
});

test('barsOf throws rather than looping forever on a zero-length metreChanges entry', () => {
  const song = baseSong({
    metreChanges: [{ tick: 1920, num: 0, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60 }, { start: 2400, dur: 1, midi: 60 }] }]
  });
  assert.throws(() => barsOf(song), /bar must be longer than zero ticks/);
});

test('barsOf throws rather than looping forever on a metre with den 0 (NaN bar length)', () => {
  const song = baseSong({
    metre: { num: 4, den: 0 },
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60 }] }]
  });
  assert.throws(() => barsOf(song), /bar must be longer than zero ticks/);
});
