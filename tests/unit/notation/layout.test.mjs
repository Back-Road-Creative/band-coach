import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMeasure } from '../../../src/notation/layout.js';

function byType(primitives, type) {
  return primitives.filter((p) => p.type === type);
}

test('layoutMeasure: draws 5 staff lines for a single clef', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }],
  });
  assert.equal(byType(primitives, 'line').length, 5);
});

test('layoutMeasure: draws 10 staff lines for a grand staff', () => {
  const { primitives } = layoutMeasure({
    clef: 'grand', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }],
  });
  assert.equal(byType(primitives, 'line').length, 10);
});

test('layoutMeasure: emits a clef, a time signature and a barline', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [3, 4], width: 400,
    notes: [{ midi: 60, dur: 3 }],
  });
  const clefs = byType(primitives, 'clef');
  assert.equal(clefs.length, 1);
  assert.equal(clefs[0].clef, 'treble');
  const timeSigs = byType(primitives, 'timeSig');
  assert.equal(timeSigs.length, 1);
  assert.deepEqual([timeSigs[0].top, timeSigs[0].bottom], [3, 4]);
  assert.equal(byType(primitives, 'barline').length, 1);
});

test('layoutMeasure: grand staff gets a clef per staff', () => {
  const { primitives } = layoutMeasure({
    clef: 'grand', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }],
  });
  const clefs = byType(primitives, 'clef');
  assert.equal(clefs.length, 2);
  assert.deepEqual(clefs.map((c) => c.clef).sort(), ['bass', 'treble']);
});

test('layoutMeasure: one keyAccidental primitive per altered letter', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'D', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }],
  });
  assert.equal(byType(primitives, 'keyAccidental').length, 2);
});

test('layoutMeasure: one notehead per note, x increasing with onset', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 1 }, { midi: 62, dur: 1 }, { midi: 64, dur: 2 }],
  });
  const heads = byType(primitives, 'notehead');
  assert.equal(heads.length, 3);
  assert.ok(heads[0].x < heads[1].x);
  assert.ok(heads[1].x < heads[2].x);
});

test('layoutMeasure: rests get a rest primitive, not a notehead', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: null, dur: 4 }],
  });
  assert.equal(byType(primitives, 'notehead').length, 0);
  assert.equal(byType(primitives, 'rest').length, 1);
});

test('layoutMeasure: stem up below the middle line, down on or above it', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    // E4 sits on the bottom line (position 0, below the middle line -> stem up);
    // B4 sits on the middle line (position 4 -> stem down).
    notes: [{ midi: 64, dur: 2 }, { midi: 71, dur: 2 }],
  });
  const stems = byType(primitives, 'stem');
  assert.equal(stems.length, 2);
  assert.ok(stems[0].y2 < stems[0].y1, 'stem up: the far end is above the notehead');
  assert.ok(stems[1].y2 > stems[1].y1, 'stem down: the far end is below the notehead');
});

test('layoutMeasure: whole notes get no stem, quarter notes do', () => {
  const wholeLayout = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }],
  });
  assert.equal(byType(wholeLayout.primitives, 'stem').length, 0);

  const quarterLayout = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 1 }, { midi: 62, dur: 1 }, { midi: 64, dur: 1 }, { midi: 65, dur: 1 }],
  });
  assert.equal(byType(quarterLayout.primitives, 'stem').length, 4);
});

test('layoutMeasure: dotted durations get a dot primitive', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 3 }, { midi: 62, dur: 1 }],
  });
  assert.equal(byType(primitives, 'dot').length, 1);
});

test('layoutMeasure: notes needing ledger lines get ledger primitives', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 60, dur: 4 }], // middle C, one ledger line below the treble staff
  });
  assert.equal(byType(primitives, 'ledger').length, 1);
});

test('layoutMeasure: grand staff splits at middle C, 60 and above -> treble', () => {
  const { primitives } = layoutMeasure({
    clef: 'grand', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 59, dur: 2 }, { midi: 60, dur: 2 }],
  });
  const heads = byType(primitives, 'notehead');
  assert.equal(heads.length, 2);
  // The two staves are drawn at different y ranges; the bass note (59) must
  // land in the lower (larger-y) staff and the treble note (60) in the upper one.
  assert.ok(heads[0].y > heads[1].y, 'B3 (bass) sits below middle C (treble) on the page');
});

test('layoutMeasure: an accidental differing from the key gets an accidental primitive', () => {
  const { primitives } = layoutMeasure({
    clef: 'treble', key: 'C', time: [4, 4], width: 400,
    notes: [{ midi: 61, dur: 4 }], // C#/Db, not in C major
  });
  assert.equal(byType(primitives, 'accidental').length, 1);
});
