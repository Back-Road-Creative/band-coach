// Proves src/song/lesson.js's harmonica "fixed pitch set" agrees with the
// canonical Richter table in src/instruments/how/harmonica.js, which it now
// imports (BLOW_STEPS/DRAW_STEPS) instead of keeping its own copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutFor } from '../../src/instruments/how/harmonica.js';
import { fitToInstrument } from '../../src/song/lesson.js';
import harp from '../../src/instruments/harp.js';

function song(notes) {
  return {
    schema: 'song/1', id: 't', title: 't', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'melody', notes }], chords: []
  };
}

test('every note in how/harmonica.js layoutFor(0) is playable on harp with no shift', () => {
  const holes = layoutFor(0);
  const expected = new Set();
  holes.forEach(h => { expected.add(h.blow); expected.add(h.draw); });

  const notes = [...expected].sort((a, b) => a - b).map((midi, i) => ({ start: i * 10, dur: 10, midi }));
  const fit = fitToInstrument(song(notes), 'melody', harp);

  assert.equal(fit.shiftSemitones, 0);
  assert.deepEqual(fit.unplayable, []);
  assert.equal(fit.notes.length, notes.length);
  fit.notes.forEach(n => assert.ok(expected.has(n.midi), n.midi + ' missing from how/harmonica.js layout'));
});

test('a full chromatic run cannot all land on Richter holes, whatever shift lesson.js picks', () => {
  // Only 7-8 of 12 chromatic pitch classes are ever reachable on a Richter
  // harmonica (see how/harmonica.js's BLOW_STEPS/DRAW_STEPS), so a run of all
  // 12 must leave some notes "not-on-instrument" for every candidate shift —
  // this is the invariant the shared table encodes, checked end-to-end
  // through fitToInstrument rather than by re-deriving the table here.
  const notes = [];
  for (let m = 60; m < 72; m++) notes.push({ start: (m - 60) * 10, dur: 10, midi: m });
  const fit = fitToInstrument(song(notes), 'melody', harp);
  assert.ok(fit.unplayable.length > 0);
  assert.ok(fit.unplayable.every(u => u.reason === 'not-on-instrument'));
});
