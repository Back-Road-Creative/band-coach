// P4-9: tabView() draws a fretted step's tab (own string lines plus
// fretNumber primitives, NOT tab.js's layoutTab -- that picks its own frets
// and ignores capo/tuning); fingeringLine() gives the one-line text for
// bowed/keys/free-reed families. Both read the arrangement's `placements`
// Map (src/song/arrange/index.js), keyed by each note's position in the
// WHOLE fitted part (practice.plan.fit.notes), never by the step's own
// (sliced) notes array -- see step-view.js's placementFor() for how that
// index trap is closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tabView, fingeringLine } from '../../src/ui/songs/step-view.js';
import gtr from '../../src/instruments/gtr.js';
import violin from '../../src/instruments/violin.js';
import kbd from '../../src/instruments/kbd.js';
import harp from '../../src/instruments/harp.js';

function arrangement(family, placements, extra = {}) {
  return { family, capo: 0, tuningName: null, placements: new Map(placements), unplayable: [], ...extra };
}

test('every tab number matches the arrangement\'s fret', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 62 }, { start: 480, dur: 480, midi: 64 }];
  const arr = arrangement('fretted', [[0, { string: 3, fret: 5 }], [1, { string: 4, fret: 2 }]]);
  const step = { notes: fitNotes };
  const view = tabView(step, arr, gtr, fitNotes);
  const frets = view.rows[0].primitives.filter((p) => p.type === 'fretNumber').map((p) => p.fret);
  assert.deepEqual(frets, [5, 2]);
});

test('strings are numbered from the highest', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 59 }];
  const arr = arrangement('fretted', [[0, { string: 4, fret: 0 }]]);
  const step = { notes: fitNotes };
  const view = tabView(step, arr, gtr, fitNotes);
  const p = view.rows[0].primitives.find((p) => p.type === 'fretNumber');
  assert.equal(p.string, 2); // gtr has 6 strings; stringIndex 4 -> display "string 2"
  assert.match(view.label, /string 2 fret 0/);
});

test('a note with no comfortable fingering is left blank and counted', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 40 }, { start: 480, dur: 480, midi: 41 }];
  // Only note 0 got a placement; note 1 (index 1) is unplaced.
  const arr = arrangement('fretted', [[0, { string: 0, fret: 0 }]]);
  const step = { notes: fitNotes };
  const view = tabView(step, arr, gtr, fitNotes);
  const frets = view.rows[0].primitives.filter((p) => p.type === 'fretNumber');
  assert.equal(frets.length, 1);
  assert.equal(view.blankCount, 1);
  assert.match(view.label, /1 note with no comfortable fingering/);
});

test('a saved capo appears on the tab view', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 62 }];
  const arr = arrangement('fretted', [[0, { string: 3, fret: 0 }]], { capo: 2 });
  const step = { notes: fitNotes };
  const view = tabView(step, arr, gtr, fitNotes);
  assert.equal(view.capo, 2);
  assert.match(view.label, /^Tab, capo 2:/);
});

test('violin line names the string and position', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 69 }, { start: 480, dur: 480, midi: 71 }, { start: 960, dur: 480, midi: 69 }];
  // violin tuning [55, 62, 69, 76] (G, D, A, E) -- index 2 is the A string.
  const arr = arrangement('bowed', [
    [0, { string: 2, position: 1, finger: 0 }],
    [1, { string: 2, position: 1, finger: 1 }],
    [2, { string: 2, position: 1, finger: 0 }],
  ]);
  const step = { notes: fitNotes };
  const line = fingeringLine(step, arr, violin, fitNotes);
  assert.equal(line.text, 'A string, 1st position: 0 1 0');
});

test('harmonica line names hole and blow/draw', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 72 }, { start: 480, dur: 480, midi: 74 }, { start: 960, dur: 480, midi: 72 }];
  const arr = arrangement('free-reed', [
    [0, { hole: 4, action: 'blow', bendSteps: 0 }],
    [1, { hole: 4, action: 'draw', bendSteps: 0 }],
    [2, { hole: 4, action: 'blow', bendSteps: 0 }],
  ]);
  const step = { notes: fitNotes };
  const line = fingeringLine(step, arr, harp, fitNotes);
  assert.equal(line.text, 'Blow 4, Draw 4, Blow 4');
});

test('keyboard line gives right-hand fingers', () => {
  const fitNotes = [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 }, { start: 960, dur: 480, midi: 64 }];
  const arr = arrangement('keys', [
    [0, { hand: 'rh', finger: 1 }],
    [1, { hand: 'rh', finger: 2 }],
    [2, { hand: 'rh', finger: 3 }],
  ]);
  const step = { notes: fitNotes };
  const line = fingeringLine(step, arr, kbd, fitNotes);
  assert.equal(line.text, 'Right hand: 1 2 3.');
});

test('a step\'s notes map back through the WHOLE fitted part, not the step\'s own slice', () => {
  // fitNotes has 4 notes; the step only covers the middle two (a slice, like
  // a real phrase step) -- this is the "index trap" the plan calls out.
  const fitNotes = [
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 62 },
    { start: 960, dur: 480, midi: 64 },
    { start: 1440, dur: 480, midi: 65 },
  ];
  const arr = arrangement('fretted', [
    [0, { string: 0, fret: 0 }],
    [1, { string: 0, fret: 2 }],
    [2, { string: 0, fret: 4 }],
    [3, { string: 0, fret: 5 }],
  ]);
  const step = { notes: fitNotes.slice(1, 3) }; // the same objects, a subset
  const view = tabView(step, arr, gtr, fitNotes);
  const frets = view.rows[0].primitives.filter((p) => p.type === 'fretNumber').map((p) => p.fret);
  assert.deepEqual(frets, [2, 4]);
});

test('fingeringLine is null for a family with nothing to say', () => {
  const arr = arrangement('wind', []);
  const line = fingeringLine({ notes: [] }, arr, kbd, []);
  assert.equal(line, null);
});
