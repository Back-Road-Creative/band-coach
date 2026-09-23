import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_QUARTER, barsOf } from '../../src/song/model.js';
import { judgeAttempt } from '../../src/ui/songs/practice.js';
import {
  barHeat, worstBars,
  GOOD_MIN_HIT_RATE, MISS_MAX_HIT_RATE, GOOD_MAX_ABS_ERROR_MS, GOOD_MAX_ABS_CENTS
} from '../../src/song/bar-heat.js';

// A 4/4 song at 480 ticks/quarter: one bar = 1920 ticks. Two bars, two
// quarter notes per bar (on beat 1 and beat 3 of each bar) so tests can put
// exactly one judged note where they want it.
function baseSong(overrides = {}) {
  return {
    schema: 'song/1', id: 'x', title: 'X', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 960, dur: 480, midi: 62 },
      { start: 1920, dur: 480, midi: 64 }, { start: 2880, dur: 480, midi: 65 }
    ] }],
    chords: [],
    ...overrides
  };
}

function match(overrides = {}) {
  return { note: { start: 0, dur: 480, midi: 60 }, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null, ...overrides };
}

test('barHeat grades a bar with all judged notes hit cleanly as good', () => {
  const song = baseSong();
  const matches = [
    match({ note: { start: 0, dur: 480, midi: 60 }, played: {}, ok: true, errorMs: 5, cents: 2 }),
    match({ note: { start: 960, dur: 480, midi: 62 }, played: {}, ok: true, errorMs: -3, cents: -1 })
  ];
  const heat = barHeat(song, matches);
  assert.equal(heat.length, 2);
  assert.equal(heat[0].bar, 0);
  assert.equal(heat[0].judged, 2);
  assert.equal(heat[0].hits, 2);
  assert.equal(heat[0].hitRate, 1);
  assert.equal(heat[0].grade, 'good');
});

test('barHeat grades a bar with every judged note missed as miss', () => {
  const song = baseSong();
  const matches = [
    match({ note: { start: 0, dur: 480, midi: 60 }, ok: false }),
    match({ note: { start: 960, dur: 480, midi: 62 }, ok: false })
  ];
  const heat = barHeat(song, matches);
  assert.equal(heat[0].hits, 0);
  assert.equal(heat[0].hitRate, 0);
  assert.equal(heat[0].grade, 'miss');
});

test('barHeat grades a bar with no judged notes as none', () => {
  const song = baseSong();
  const matches = [
    match({ note: { start: 1920, dur: 480, midi: 64 }, ok: true, errorMs: 0, cents: 0 })
  ];
  const heat = barHeat(song, matches);
  assert.equal(heat[0].judged, 0);
  assert.equal(heat[0].hits, 0);
  assert.equal(heat[0].grade, 'none');
  assert.equal(heat[1].grade, 'good');
});

test('barHeat grades a bar with big timing/pitch errors as shaky even though every note was hit', () => {
  const song = baseSong();
  const bigError = GOOD_MAX_ABS_ERROR_MS + 50;
  const bigCents = GOOD_MAX_ABS_CENTS + 50;
  const matches = [
    match({ note: { start: 0, dur: 480, midi: 60 }, ok: true, errorMs: bigError, cents: bigCents }),
    match({ note: { start: 960, dur: 480, midi: 62 }, ok: true, errorMs: -bigError, cents: -bigCents })
  ];
  const heat = barHeat(song, matches);
  assert.equal(heat[0].hitRate, 1);
  assert.ok(heat[0].meanAbsErrorMs > GOOD_MAX_ABS_ERROR_MS);
  assert.equal(heat[0].grade, 'shaky');
});

test('barHeat thresholds are exported and consistent (good needs high hit rate, miss is low hit rate)', () => {
  assert.ok(GOOD_MIN_HIT_RATE > MISS_MAX_HIT_RATE);
});

test('barHeat moves bar boundaries at a metre change', () => {
  // 4/4 for bar 0 (0-1919), switching to 3/4 (1440 ticks) at tick 1920.
  const song = baseSong({
    metreChanges: [{ tick: 1920, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 },
      { start: 1920, dur: 480, midi: 62 },
      // Under the old 4/4 bar length this would still be in bar 1 (ends at
      // 3839), but under 3/4 (1440 ticks/bar starting at 1920) bar 1 ends at
      // 3360, so this note (start 3360) falls in bar 2.
      { start: 3360, dur: 480, midi: 64 }
    ] }]
  });
  const matches = [
    match({ note: { start: 0, dur: 480, midi: 60 }, ok: true, errorMs: 0, cents: 0 }),
    match({ note: { start: 1920, dur: 480, midi: 62 }, ok: true, errorMs: 0, cents: 0 }),
    match({ note: { start: 3360, dur: 480, midi: 64 }, ok: true, errorMs: 0, cents: 0 })
  ];
  const heat = barHeat(song, matches);
  assert.equal(heat[0].judged, 1);
  assert.equal(heat[1].judged, 1);
  assert.equal(heat[2].judged, 1);
});

test('worstBars returns the n lowest-graded bars, ties broken by bar order', () => {
  const song = baseSong({
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 1920, dur: 480, midi: 62 },
      { start: 3840, dur: 480, midi: 64 }, { start: 5760, dur: 480, midi: 65 }
    ] }]
  });
  const matches = [
    match({ note: { start: 0, dur: 480, midi: 60 }, ok: true, errorMs: 0, cents: 0 }),   // bar 0: good
    match({ note: { start: 1920, dur: 480, midi: 62 }, ok: false }),                       // bar 1: miss
    match({ note: { start: 3840, dur: 480, midi: 64 }, ok: false }),                       // bar 2: miss
    match({ note: { start: 5760, dur: 480, midi: 65 }, ok: true, errorMs: 0, cents: 0 })  // bar 3: good
  ];
  const heat = barHeat(song, matches);
  const worst = worstBars(heat, 2);
  assert.equal(worst.length, 2);
  assert.equal(worst[0].bar, 1);
  assert.equal(worst[1].bar, 2);
});

test('barHeat integration: a real judgeAttempt result feeds straight into barHeat', () => {
  const song = baseSong();
  const expectedNotes = song.parts[0].notes;
  const playedEvents = [
    { midi: 60, atSec: 0.0 },
    { midi: 62, atSec: 1.0 },
    // bar 1's notes (midi 64, 65) are skipped entirely by the player
  ];
  const result = judgeAttempt(expectedNotes, playedEvents, { bpm: song.bpm, ticksPerQuarter: song.ticksPerQuarter });
  const heat = barHeat(song, result.matches);
  assert.equal(heat.length, 2);
  assert.equal(heat[0].grade, 'good');
  assert.equal(heat[1].grade, 'miss');
});

test('barHeat uses the same bar windows as barsOf when a metre change lands mid-bar', () => {
  // The change at 2400 falls inside the second 4/4 bar (1920-3840). barsOf
  // ends that bar AT the change, so the 3/4 bar then runs from 2400 to 3840.
  // A note at 3000 therefore sits in bar 2, not bar 1.
  const song = baseSong({
    metreChanges: [{ tick: 2400, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 }, { start: 1920, dur: 480, midi: 62 }, { start: 3000, dur: 480, midi: 64 }
    ] }]
  });
  const matches = song.parts[0].notes.map((note) => match({ note, ok: true, errorMs: 0, cents: 0 }));
  const heat = barHeat(song, matches);
  assert.equal(heat.length, barsOf(song).length - 1);
  assert.deepEqual(heat.map((h) => h.judged), [1, 1, 1]);
});
