// Import fidelity report (plan unit E6a): a pure measurement of how far a
// song part in the app's own data actually diverges from the notes an
// importer originally saw, plus how much fitToInstrument()/arrangeFor()
// still have to bend it to fit a chosen instrument. Nothing here is
// user-facing text -- this module hands back plain data for a later caller
// (E6c) to word.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fidelityReport } from '../../src/song/eval/fidelity.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';

const kbd = INSTRUMENTS.find((r) => r.id === 'kbd');
const flute = INSTRUMENTS.find((r) => r.id === 'flute');

function songWith(notes) {
  return { schema: 'song/1', id: 'test-song', parts: [{ id: 'melody', name: 'Melody', notes }] };
}

test('a note below the instrument range is reported out-of-range, with no octave shift', () => {
  // C2 (36) is far below kbd's 48-72 range and C5 (72) sits at the very top,
  // so no single octave shift can rescue both -- fitToInstrument leaves the
  // song untransposed and flags only the low note (see lesson.js's
  // candidateShifts/notePlayable).
  const song = songWith([{ start: 0, dur: 480, midi: 36 }, { start: 480, dur: 480, midi: 72 }]);
  const report = fidelityReport(null, song, 'melody', kbd);
  assert.equal(report.outOfRange.length, 1);
  assert.equal(report.outOfRange[0].midi, 36);
  assert.equal(report.outOfRange[0].reason, 'out-of-range');
  assert.equal(report.octaveShift, 0);
});

test('two identical source notes collapsed to one in the song are reported merged, not dropped', () => {
  const song = songWith([{ start: 0, dur: 480, midi: 60 }]);
  const sourceNotes = [{ start: 0, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 60 }];
  const report = fidelityReport(sourceNotes, song, 'melody', kbd);
  assert.deepEqual(report.merged, [{ start: 0, midi: 60, count: 2 }]);
  assert.deepEqual(report.dropped, []);
});

test('a source note with no counterpart in the song part is reported dropped', () => {
  const song = songWith([{ start: 0, dur: 480, midi: 60 }]);
  const sourceNotes = [{ start: 0, dur: 480, midi: 60 }, { start: 960, dur: 480, midi: 64 }];
  const report = fidelityReport(sourceNotes, song, 'melody', kbd);
  assert.equal(report.dropped.length, 1);
  assert.equal(report.dropped[0].start, 960);
  assert.equal(report.dropped[0].midi, 64);
});

test('the minuet-in-g starter on kbd matches its own feasibility/lesson-plan result', () => {
  const minuet = starterSongs.find((s) => s.id === 'minuet-in-g');
  const report = fidelityReport(null, minuet, 'melody', kbd);
  assert.equal(report.octaveShift, -12);
  assert.deepEqual(report.outOfRange, []);
  assert.deepEqual(report.hands, { rh: 7, lh: 25 });
});

test('hot-cross-buns on kbd compared against its own notes is a perfectly clean report', () => {
  const hcb = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const part = hcb.parts.find((p) => p.id === 'melody');
  const report = fidelityReport(part.notes, hcb, 'melody', kbd);
  assert.deepEqual(report.dropped, []);
  assert.deepEqual(report.merged, []);
  assert.deepEqual(report.outOfRange, []);
  assert.equal(report.octaveShift, 0);
  assert.deepEqual(report.hands, { rh: 17, lh: 0 });
});

test('a chord on a single-line instrument is reported chord-reduced, not out-of-range, and hands is null', () => {
  // Both notes sit inside flute's 60-72 range individually; only sharing a
  // start makes the lower one unplayable, via chordReductionFor in
  // lesson.js, not the range check.
  const song = songWith([{ start: 0, dur: 480, midi: 65 }, { start: 0, dur: 480, midi: 68 }]);
  const report = fidelityReport(null, song, 'melody', flute);
  assert.equal(report.chordReduced.length, 1);
  assert.equal(report.chordReduced[0].midi, 65);
  assert.deepEqual(report.outOfRange, []);
  assert.equal(report.hands, null);
});
