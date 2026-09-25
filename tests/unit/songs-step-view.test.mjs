// P4-8: staffView() turns one practice step's bars into a pure notation
// layout in the instrument's own clef and written pitch/key -- see
// src/ui/songs/step-view.js's own header for the design.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { staffView } from '../../src/ui/songs/step-view.js';
import kbd from '../../src/instruments/kbd.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';

const TPQ = 480;

function song({ metre = { num: 4, den: 4 }, key = { tonic: 0, mode: 'major' }, metreChanges, notes = [] } = {}) {
  const s = {
    schema: 'song/1', id: 'fixture', title: 'Fixture', composer: null, licence: null, source: null,
    key, metre, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes }], chords: [],
  };
  if (metreChanges) s.metreChanges = metreChanges;
  return s;
}

// Hot Cross Buns bar 1: E4 D4 C4(half) in C major -- the brief's own worked
// example ("Bars 1-2, treble staff, D major: F♯ E D, F♯ E D").
const HOT_CROSS_BUNS_BAR1 = [
  { start: 0, dur: 480, midi: 64 },
  { start: 480, dur: 480, midi: 62 },
  { start: 960, dur: 960, midi: 60 },
];

test('a keyboard step uses the grand staff', () => {
  const s = song({ notes: HOT_CROSS_BUNS_BAR1 });
  const step = { bars: [0, 0], notes: HOT_CROSS_BUNS_BAR1 };
  const view = staffView(s, step, kbd, {});
  assert.equal(view.kind, 'staff');
  assert.equal(view.rows.length, 1);
  assert.ok(view.rows[0].primitives.some((p) => p.type === 'clef' && p.clef === 'treble'));
  assert.ok(view.rows[0].primitives.some((p) => p.type === 'clef' && p.clef === 'bass'));
});

test('clarinet notes are drawn a tone higher in D major', () => {
  const s = song({ notes: HOT_CROSS_BUNS_BAR1 });
  const step = { bars: [0, 0], notes: HOT_CROSS_BUNS_BAR1 };
  const view = staffView(s, step, clarinetBb, {});
  assert.match(view.label, /F♯/);
  assert.match(view.label, /D major/);
});

test('a 3/4 bar after a 4/4 bar gets its own time', () => {
  const notes = [
    { start: 0, dur: 1920, midi: 60 },
    { start: 1920, dur: 1440, midi: 62 },
  ];
  const s = song({ notes, metreChanges: [{ tick: 1920, num: 3, den: 4 }] });
  const step = { bars: [0, 1], notes };
  const view = staffView(s, step, kbd, {});
  assert.equal(view.rows.length, 2);
  const firstTimeSig = view.rows[0].primitives.find((p) => p.type === 'timeSig');
  assert.equal(firstTimeSig.top, 4);
  const secondTimeSig = view.rows[1].primitives.find((p) => p.type === 'timeSig');
  assert.equal(secondTimeSig.top, 3);
});

test('the view covers only the step\'s bars', () => {
  const notes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 1920, dur: 480, midi: 62 },
    { start: 3840, dur: 480, midi: 64 },
    { start: 5760, dur: 480, midi: 65 },
    { start: 7680, dur: 480, midi: 67 },
  ];
  const s = song({ notes });
  const step = { bars: [1, 2], notes };
  const view = staffView(s, step, kbd, {});
  assert.equal(view.rows.length, 2);
  assert.match(view.label, /^Bars 2-3/);
});

test('a whole-piece step is capped at 16 bars and says so', () => {
  const notes = [{ start: 20 * 1920 - 1, dur: 1, midi: 60 }];
  const s = song({ notes });
  const step = { bars: [0, 19], notes: [] };
  const view = staffView(s, step, kbd, {});
  assert.equal(view.rows.length, 16);
  assert.match(view.label, /first 16 bars shown/);
});
