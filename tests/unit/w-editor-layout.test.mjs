// layoutSong (src/ui/editor/layout-song.js) turns a Song into staff-notation
// primitives (via the shared src/notation/layout.js engine) one bar per row,
// plus hit boxes that must line up with hitTest (src/song/edit.js) so a
// click or a keyboard selection lands on the right note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSong } from '../../src/ui/editor/layout-song.js';
import { hitTest } from '../../src/song/edit.js';

const TPQ = 480;

function song(notes, metre = { num: 4, den: 4 }) {
  return {
    schema: 'song/1', id: 's', title: 'Test', composer: null, licence: null, source: null,
    key: null, metre, bpm: 120, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes }],
    chords: [],
  };
}

test('one bar of quarter notes lays out as a single row with 4 hit boxes', () => {
  const s = song([
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 62 },
    { start: 960, dur: 480, midi: 64 },
    { start: 1440, dur: 480, midi: 65 },
  ]);
  const layout = layoutSong(s, 0, { clef: 'treble', key: 'C', width: 260 });
  assert.equal(layout.barCount, 1);
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.hitboxes.length, 4);
  assert.deepEqual(layout.hitboxes.map((h) => h.noteIndex).sort(), [0, 1, 2, 3]);
});

test('a note past the end of bar 1 starts bar 2, one row per bar', () => {
  const s = song([
    { start: 0, dur: 1920, midi: 60 }, // fills bar 1 (4/4 at 480 tpq = 1920 ticks)
    { start: 1920, dur: 480, midi: 62 },
  ]);
  const layout = layoutSong(s, 0, { width: 260 });
  assert.equal(layout.barCount, 2);
  assert.equal(layout.rows[1].y0, layout.rowHeight);
  assert.equal(layout.hitboxes.length, 2);
});

test('a gap between notes is filled with a rest, not a hit box', () => {
  const s = song([
    { start: 0, dur: 480, midi: 60 },
    { start: 1440, dur: 480, midi: 62 }, // gap of 960 ticks (a half-note rest) before this one
  ]);
  const layout = layoutSong(s, 0, { width: 260 });
  assert.equal(layout.hitboxes.length, 2);
  const restCount = layout.rows[0].primitives.filter((p) => p.type === 'rest').length;
  assert.equal(restCount, 1);
});

test('hit boxes line up with hitTest: clicking a notehead selects its note index', () => {
  const s = song([
    { start: 0, dur: 480, midi: 60 },
    { start: 480, dur: 480, midi: 72 }, // higher pitch, different y
  ]);
  const layout = layoutSong(s, 0, { width: 260 });
  for (const box of layout.hitboxes) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const hit = hitTest(layout.hitboxes, cx, cy);
    assert.ok(hit, 'the center of every hit box must hit-test to something');
    assert.equal(hit.noteIndex, box.noteIndex);
  }
});

test('an empty part still produces one bar with a whole rest, no hit boxes', () => {
  const s = song([]);
  const layout = layoutSong(s, 0, { width: 260 });
  assert.equal(layout.barCount, 1);
  assert.equal(layout.hitboxes.length, 0);
});
