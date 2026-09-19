import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveNote,
  repitch,
  resize,
  deleteNote,
  insertNote,
  splitNote,
  mergeWithNext,
  setTie,
  transposeRange,
  shiftRange,
  deleteRange,
  quantizeRange,
  setBpm,
  setMetre,
  setKey,
  shiftBarline,
  halveDurations,
  doubleDurations,
  octaveShiftPart,
  createHistory,
  hitTest,
} from '../../src/song/edit.js';
import { ticksToSeconds } from '../../src/song/model.js';

// A tiny song fixture: one part, three notes, no gaps, no overlaps.
function fixture() {
  return {
    schema: 'song/1',
    id: 's1',
    title: 'Fixture',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 120,
    ticksPerQuarter: 480,
    parts: [
      {
        id: 'p1',
        name: 'lead',
        notes: [
          { start: 0, dur: 480, midi: 60 },
          { start: 480, dur: 480, midi: 62 },
          { start: 960, dur: 480, midi: 64 },
        ],
      },
    ],
    chords: [{ start: 0, symbol: 'C' }],
  };
}

function assertSorted(notes) {
  for (let i = 1; i < notes.length; i++) {
    assert.ok(notes[i].start >= notes[i - 1].start, 'notes must stay sorted by start');
  }
}

function assertNoOverlap(notes) {
  for (let i = 1; i < notes.length; i++) {
    assert.ok(notes[i - 1].start + notes[i - 1].dur <= notes[i].start, 'notes must not overlap');
  }
}

function assertPositiveDurations(notes) {
  for (const n of notes) assert.ok(n.dur > 0, 'duration must stay positive');
}

// ---------- note ops ----------

test('moveNote: snaps to grid and moves the note without mutating the input', () => {
  const song = fixture();
  const before = JSON.parse(JSON.stringify(song));
  const { song: out, changed } = moveNote(song, 0, 0, 100, 240);
  assert.deepEqual(song, before, 'input song must not be mutated');
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  const moved = notes.find((n) => n.midi === 60);
  assert.equal(moved.start, 0, 'expected 100 snapped to nearest 240-tick grid (0)');
  assert.ok(changed.length >= 1);
});

test('moveNote: moving the first note past the last resorts the array', () => {
  const song = fixture();
  const { song: out } = moveNote(song, 0, 0, 2000, 1);
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assert.equal(notes[notes.length - 1].midi, 60);
});

test('moveNote: moving onto another note trims the earlier note (documented overlap rule)', () => {
  const song = fixture();
  // move note 2 (midi 64, start 960) to start 200, overlapping note 0 (0..480) and note1(480..960)
  const { song: out } = moveNote(song, 0, 2, 200, 1);
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  assertPositiveDurations(notes);
  const first = notes.find((n) => n.midi === 60);
  assert.equal(first.dur, 200, 'earlier note trimmed to end exactly where the moved note begins');
});

test('moveNote: clamps a negative target start to zero', () => {
  const song = fixture();
  const { song: out } = moveNote(song, 0, 1, -500, 1);
  const moved = out.parts[0].notes.find((n) => n.midi === 62);
  assert.equal(moved.start, 0);
});

test('repitch: semitone and octave shifts, and absolute set', () => {
  const song = fixture();
  const r1 = repitch(song, 0, 0, { semitones: 2 });
  assert.equal(r1.song.parts[0].notes[0].midi, 62);
  assert.deepEqual(r1.changed, [0]);

  const r2 = repitch(song, 0, 0, { octaves: 1 });
  assert.equal(r2.song.parts[0].notes[0].midi, 72);

  const r3 = repitch(song, 0, 0, { set: 40 });
  assert.equal(r3.song.parts[0].notes[0].midi, 40);
});

test('repitch: clamps to valid MIDI range', () => {
  const song = fixture();
  const low = repitch(song, 0, 0, { semitones: -1000 });
  assert.equal(low.song.parts[0].notes[0].midi, 0);
  const high = repitch(song, 0, 0, { semitones: 1000 });
  assert.equal(high.song.parts[0].notes[0].midi, 127);
});

test('resize: shrinks a note freely', () => {
  const song = fixture();
  const { song: out, changed } = resize(song, 0, 0, 100);
  assert.equal(out.parts[0].notes[0].dur, 100);
  assert.deepEqual(changed, [0]);
});

test('resize: growing into the next note trims that neighbor', () => {
  const song = fixture();
  const { song: out } = resize(song, 0, 0, 700); // note0 now 0..700, overlaps note1 (480..960)
  const notes = out.parts[0].notes;
  assertNoOverlap(notes);
  const n1 = notes.find((n) => n.midi === 62);
  assert.equal(n1.start, 700);
  assert.equal(n1.dur, 260, 'trimmed to keep its end fixed at 960');
});

test('resize: refuses a zero or negative duration', () => {
  const song = fixture();
  assert.throws(() => resize(song, 0, 0, 0));
  assert.throws(() => resize(song, 0, 0, -10));
});

test('deleteNote: removes the note, leaving the rest sorted with no gaps introduced', () => {
  const song = fixture();
  const { song: out, changed } = deleteNote(song, 0, 1);
  assert.equal(out.parts[0].notes.length, 2);
  assert.deepEqual(
    out.parts[0].notes.map((n) => n.midi),
    [60, 64],
  );
  assert.deepEqual(changed, []);
});

test('deleteNote: last note in the part', () => {
  const song = fixture();
  const { song: out } = deleteNote(song, 0, 2);
  assert.equal(out.parts[0].notes.length, 2);
});

test('deleteNote: only note in the part leaves an empty notes array', () => {
  const song = fixture();
  song.parts[0].notes = [{ start: 0, dur: 10, midi: 60 }];
  const { song: out } = deleteNote(song, 0, 0);
  assert.deepEqual(out.parts[0].notes, []);
});

test('insertNote: inserts in sorted position and trims an overlapped neighbor', () => {
  const song = fixture();
  const { song: out, changed } = insertNote(song, 0, { start: 100, dur: 200, midi: 67 });
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  assertPositiveDurations(notes);
  assert.ok(changed.length >= 1);
  const first = notes.find((n) => n.midi === 60);
  assert.equal(first.dur, 100);
});

test('insertNote: refuses a non-positive duration', () => {
  const song = fixture();
  assert.throws(() => insertNote(song, 0, { start: 0, dur: 0, midi: 60 }));
});

test('splitNote: splits into two notes that sum to the original span, second ties from the first', () => {
  const song = fixture();
  const { song: out, changed } = splitNote(song, 0, 0, 200);
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  const a = notes[0];
  const b = notes[1];
  assert.equal(a.start, 0);
  assert.equal(a.dur, 200);
  assert.equal(b.start, 200);
  assert.equal(b.dur, 280);
  assert.equal(b.tieFromPrev, true);
  assert.equal(b.midi, 60);
  assert.equal(changed.length, 2);
});

test('splitNote: refuses an offset outside the note', () => {
  const song = fixture();
  assert.throws(() => splitNote(song, 0, 0, 0));
  assert.throws(() => splitNote(song, 0, 0, 480));
  assert.throws(() => splitNote(song, 0, 0, 481));
});

test('mergeWithNext: merges two adjacent same-pitch notes into one', () => {
  const song = fixture();
  song.parts[0].notes[1].midi = 60; // make note1 same pitch as note0
  const { song: out, changed } = mergeWithNext(song, 0, 0);
  const notes = out.parts[0].notes;
  assert.equal(notes.length, 2);
  assert.equal(notes[0].start, 0);
  assert.equal(notes[0].dur, 960);
  assert.equal(notes[0].midi, 60);
  assert.ok(changed.length >= 1);
});

test('mergeWithNext: refuses when pitches differ or there is no next note', () => {
  const song = fixture();
  assert.throws(() => mergeWithNext(song, 0, 0)); // 60 vs 62
  assert.throws(() => mergeWithNext(song, 0, 2)); // last note, no next
});

test('setTie: sets and clears tieFromPrev', () => {
  const song = fixture();
  const on = setTie(song, 0, 1, true);
  assert.equal(on.song.parts[0].notes[1].tieFromPrev, true);
  const off = setTie(on.song, 0, 1, false);
  assert.equal('tieFromPrev' in off.song.parts[0].notes[1], false);
});

// ---------- selection ops ----------

test('transposeRange: shifts pitches of notes starting within [start,end)', () => {
  const song = fixture();
  const { song: out, changed } = transposeRange(song, 0, { start: 0, end: 960 }, 5);
  const notes = out.parts[0].notes;
  assert.equal(notes[0].midi, 65);
  assert.equal(notes[1].midi, 67);
  assert.equal(notes[2].midi, 64, 'note starting at 960 is outside the half-open range');
  assert.deepEqual(changed.sort(), [0, 1]);
});

test('transposeRange: a range covering nothing changes nothing', () => {
  const song = fixture();
  const { song: out, changed } = transposeRange(song, 0, { start: 5000, end: 6000 }, 5);
  assert.deepEqual(
    out.parts[0].notes.map((n) => n.midi),
    [60, 62, 64],
  );
  assert.deepEqual(changed, []);
});

test('shiftRange: moves selected notes and resolves any resulting overlap', () => {
  const song = fixture();
  const { song: out } = shiftRange(song, 0, { start: 0, end: 480 }, 700, 1);
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  assertPositiveDurations(notes);
  const moved = notes.find((n) => n.midi === 60);
  assert.equal(moved.start, 700);
});

test('shiftRange: clamps below zero', () => {
  const song = fixture();
  const { song: out } = shiftRange(song, 0, { start: 480, end: 960 }, -10000, 1);
  const moved = out.parts[0].notes.find((n) => n.midi === 62);
  assert.equal(moved.start, 0);
});

test('deleteRange: removes every note starting within the range', () => {
  const song = fixture();
  const { song: out, changed } = deleteRange(song, 0, { start: 0, end: 960 });
  assert.deepEqual(
    out.parts[0].notes.map((n) => n.midi),
    [64],
  );
  assert.deepEqual(changed, []);
});

test('deleteRange: a range covering nothing changes nothing', () => {
  const song = fixture();
  const { song: out } = deleteRange(song, 0, { start: 5000, end: 6000 });
  assert.equal(out.parts[0].notes.length, 3);
});

test('quantizeRange: snaps selected note starts to the grid and keeps sort/no-overlap', () => {
  const song = fixture();
  song.parts[0].notes[1].start = 500; // slightly off-grid
  const { song: out, changed } = quantizeRange(song, 0, { start: 0, end: 2000 }, 480);
  const notes = out.parts[0].notes;
  assertSorted(notes);
  assertNoOverlap(notes);
  const q = notes.find((n) => n.midi === 62);
  assert.equal(q.start, 480);
  assert.ok(changed.includes(notes.indexOf(q)));
});

// ---------- song ops ----------

test('setBpm: replaces bpm, refuses non-positive', () => {
  const song = fixture();
  const { song: out } = setBpm(song, 90);
  assert.equal(out.bpm, 90);
  assert.throws(() => setBpm(song, 0));
  assert.throws(() => setBpm(song, -5));
});

test('setMetre: re-bars without moving any note', () => {
  const song = fixture();
  const before = song.parts[0].notes.map((n) => n.start);
  const { song: out } = setMetre(song, { num: 3, den: 4 });
  assert.deepEqual(out.metre, { num: 3, den: 4 });
  assert.deepEqual(
    out.parts[0].notes.map((n) => n.start),
    before,
  );
});

test('setKey: replaces the key, accepts null', () => {
  const song = fixture();
  const a = setKey(song, { tonic: 7, mode: 'minor' });
  assert.deepEqual(a.song.key, { tonic: 7, mode: 'minor' });
  const b = setKey(song, null);
  assert.equal(b.song.key, null);
});

test('shiftBarline: shifts every note and chord start by the pickup, keeps spacing', () => {
  const song = fixture();
  const { song: out } = shiftBarline(song, 240);
  const notes = out.parts[0].notes;
  assert.deepEqual(
    notes.map((n) => n.start),
    [240, 720, 1200],
  );
  assert.equal(out.chords[0].start, 240);
  assertNoOverlap(notes);
});

test('shiftBarline: refuses a pickup that would push a note negative', () => {
  const song = fixture();
  assert.throws(() => shiftBarline(song, -1000));
});

test('halveDurations: fixes a double-time transcription and compensates bpm', () => {
  const song = fixture();
  const { song: out } = halveDurations(song);
  assert.deepEqual(
    out.parts[0].notes.map((n) => [n.start, n.dur]),
    [
      [0, 240],
      [240, 240],
      [480, 240],
    ],
  );
  assert.equal(out.bpm, 60, 'bpm halves with the note values, so the sounding speed is unchanged');
  assertPositiveDurations(out.parts[0].notes);
  // The point of the op: the notation reads correctly and the tune still
  // sounds at the same speed. seconds = ticks / tpq * 60 / bpm, so bpm must
  // move WITH the tick scale, not against it.
  const secondsBefore = ticksToSeconds(song.parts[0].notes[2].start, song.bpm);
  const secondsAfter = ticksToSeconds(out.parts[0].notes[2].start, out.bpm);
  assert.equal(secondsAfter, secondsBefore, 'the third note still falls at the same moment');
});

test('doubleDurations: fixes a half-time transcription and compensates bpm', () => {
  const song = fixture();
  const { song: out } = doubleDurations(song);
  assert.deepEqual(
    out.parts[0].notes.map((n) => [n.start, n.dur]),
    [
      [0, 960],
      [960, 960],
      [1920, 960],
    ],
  );
  assert.equal(out.bpm, 240);
  assert.equal(
    ticksToSeconds(out.parts[0].notes[2].start, out.bpm),
    ticksToSeconds(song.parts[0].notes[2].start, song.bpm),
    'the third note still falls at the same moment',
  );
});

test('halveDurations: never produces a zero duration even for a 1-tick note', () => {
  const song = fixture();
  song.parts[0].notes = [{ start: 0, dur: 1, midi: 60 }];
  const { song: out } = halveDurations(song);
  assert.ok(out.parts[0].notes[0].dur >= 1);
});

test('octaveShiftPart: shifts every note in the part by whole octaves and clamps', () => {
  const song = fixture();
  const { song: out, changed } = octaveShiftPart(song, 0, 1);
  assert.deepEqual(
    out.parts[0].notes.map((n) => n.midi),
    [72, 74, 76],
  );
  assert.equal(changed.length, 3);
  const clamped = octaveShiftPart(song, 0, 10);
  assert.ok(clamped.song.parts[0].notes.every((n) => n.midi <= 127));
});

// ---------- history ----------

test('createHistory: apply/undo/redo/current round-trip', () => {
  const song = fixture();
  const h = createHistory(song, { limit: 10 });
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);

  h.apply((s) => setBpm(s, 100));
  assert.equal(h.current().bpm, 100);
  assert.equal(h.canUndo, true);

  h.apply((s) => setBpm(s, 140));
  assert.equal(h.current().bpm, 140);

  const afterUndo = h.undo();
  assert.equal(afterUndo.bpm, 100);
  assert.equal(h.canRedo, true);

  const afterRedo = h.redo();
  assert.equal(afterRedo.bpm, 140);
  assert.equal(h.canRedo, false);
});

test('createHistory: undo below the bottom and redo above the top are no-ops', () => {
  const song = fixture();
  const h = createHistory(song);
  assert.equal(h.undo(), song === h.current() ? h.current() : h.current());
  assert.equal(h.canUndo, false);
  h.apply((s) => setBpm(s, 100));
  h.redo();
  assert.equal(h.current().bpm, 100);
});

test('createHistory: applying after undo discards the redo branch', () => {
  const song = fixture();
  const h = createHistory(song);
  h.apply((s) => setBpm(s, 100));
  h.apply((s) => setBpm(s, 140));
  h.undo();
  h.apply((s) => setBpm(s, 200));
  assert.equal(h.canRedo, false, 'redo branch to 140 must be discarded');
  assert.equal(h.current().bpm, 200);
});

test('createHistory: respects a limit by dropping the oldest state', () => {
  const song = fixture();
  const h = createHistory(song, { limit: 2 });
  h.apply((s) => setBpm(s, 100));
  h.apply((s) => setBpm(s, 140));
  h.apply((s) => setBpm(s, 180));
  // only the last 2 states should be retained; undoing twice cannot reach the original bpm(120)
  h.undo();
  h.undo();
  assert.equal(h.canUndo, false);
});

// ---------- hitTest ----------

test('hitTest: finds the box under a point', () => {
  const boxes = [
    { noteIndex: 0, x: 0, y: 0, w: 10, h: 10 },
    { noteIndex: 1, x: 20, y: 0, w: 10, h: 10 },
  ];
  assert.equal(hitTest(boxes, 5, 5).noteIndex, 0);
  assert.equal(hitTest(boxes, 25, 5).noteIndex, 1);
  assert.equal(hitTest(boxes, 15, 5), null);
});

test('hitTest: returns the topmost (last-drawn) box when boxes overlap', () => {
  const boxes = [
    { noteIndex: 0, x: 0, y: 0, w: 10, h: 10 },
    { noteIndex: 1, x: 5, y: 5, w: 10, h: 10 },
  ];
  assert.equal(hitTest(boxes, 6, 6).noteIndex, 1);
});

test('hitTest: a slop parameter widens the hit area for touch', () => {
  const boxes = [{ noteIndex: 0, x: 10, y: 10, w: 10, h: 10 }];
  assert.equal(hitTest(boxes, 8, 15), null);
  assert.equal(hitTest(boxes, 8, 15, 5).noteIndex, 0);
});
