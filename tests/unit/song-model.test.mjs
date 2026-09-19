import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA, TICKS_PER_QUARTER, validateSong, normalizeSong, songDurationTicks,
  barsOf, notesInBar, partRange, transpose, ticksToSeconds
} from '../../src/song/model.js';

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

// ---- validateSong ----

test('validateSong accepts a well-formed song and a null key', () => {
  assert.equal(validateSong(baseSong()).ok, true);
  assert.equal(validateSong(baseSong({ key: null })).ok, true);
});

test('validateSong rejects non-objects and bad top-level fields', () => {
  assert.equal(validateSong(null).ok, false);
  assert.ok(validateSong(baseSong({ schema: 'song/2' })).errors.some(e => e.includes('schema')));
  assert.ok(validateSong(baseSong({ ticksPerQuarter: 96 })).errors.some(e => e.includes('ticksPerQuarter')));
  assert.ok(validateSong(baseSong({ chords: 'nope' })).errors.length > 0);
});

test('validateSong rejects bad notes: midi range, negative ticks, unsorted', () => {
  const bad1 = baseSong(); bad1.parts[0].notes[0].midi = 200;
  assert.ok(validateSong(bad1).errors.some(e => e.includes('midi')));

  const bad2 = baseSong(); bad2.parts[0].notes[0].start = -1;
  assert.ok(validateSong(bad2).errors.some(e => e.includes('start')));

  const bad3 = baseSong({ parts: [{ id: 'm', name: 'M', notes: [
    { start: 480, dur: 480, midi: 60 }, { start: 0, dur: 480, midi: 62 }
  ] }] });
  assert.ok(validateSong(bad3).errors.some(e => e.includes('sorted')));
});

test('validateSong rejects insane metre and bad key', () => {
  const badMetre = validateSong(baseSong({ metre: { num: 0, den: 3 } }));
  assert.ok(badMetre.errors.some(e => e.includes('metre.num')));
  assert.ok(badMetre.errors.some(e => e.includes('metre.den')));

  const badKey = validateSong(baseSong({ key: { tonic: 20, mode: 'dorian' } }));
  assert.ok(badKey.errors.some(e => e.includes('key.tonic')));
  assert.ok(badKey.errors.some(e => e.includes('key.mode')));
});

test('validateSong enforces confidence range', () => {
  const song = baseSong(); song.parts[0].notes[0].confidence = 1.5;
  assert.ok(validateSong(song).errors.some(e => e.includes('confidence')));
});

test('validateSong tie rules: accepts a legitimate tie, rejects pitch mismatch/gap/first-note', () => {
  const good = baseSong({ parts: [{ id: 'm', name: 'M', notes: [
    { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 60, tieFromPrev: true }
  ] }] });
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const wrongPitch = baseSong({ parts: [{ id: 'm', name: 'M', notes: [
    { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62, tieFromPrev: true }
  ] }] });
  assert.ok(validateSong(wrongPitch).errors.some(e => e.includes('tieFromPrev') && e.includes('pitch')));

  const gap = baseSong({ parts: [{ id: 'm', name: 'M', notes: [
    { start: 0, dur: 240, midi: 60 }, { start: 480, dur: 480, midi: 60, tieFromPrev: true }
  ] }] });
  assert.ok(validateSong(gap).errors.some(e => e.includes('tieFromPrev')));

  const firstNote = baseSong({ parts: [{ id: 'm', name: 'M', notes: [
    { start: 0, dur: 480, midi: 60, tieFromPrev: true }
  ] }] });
  assert.ok(validateSong(firstNote).errors.some(e => e.includes('tieFromPrev')));
});

// ---- normalizeSong ----

test('normalizeSong sorts notes, fills defaults, clamps, strips unknown keys', () => {
  const sorted = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 480, dur: 240, midi: 60 }, { start: 0, dur: 240, midi: 62 }
  ] }] });
  assert.deepEqual(sorted.parts[0].notes.map(n => n.start), [0, 480]);

  const defaults = normalizeSong({ id: 'x', parts: [], chords: [] });
  assert.equal(defaults.schema, SCHEMA);
  assert.equal(defaults.title, 'Untitled');
  assert.equal(defaults.composer, null);
  assert.equal(defaults.bpm, 120);
  assert.deepEqual(defaults.metre, { num: 4, den: 4 });
  assert.equal(defaults.ticksPerQuarter, TICKS_PER_QUARTER);

  const clamped = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: -50, dur: -10, midi: 999 }
  ] }] });
  const note = clamped.parts[0].notes[0];
  assert.equal(note.start, 0);
  assert.equal(note.midi, 127);
  assert.equal(note.dur, 1);

  const stripped = normalizeSong({ id: 'x', bogus: 'field', parts: [], chords: [] });
  assert.equal('bogus' in stripped, false);
});

test('normalizeSong drops a tie that no longer holds after clamping', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 480, midi: 60 }, { start: 500, dur: 480, midi: 60, tieFromPrev: true }
  ] }] });
  assert.equal('tieFromPrev' in song.parts[0].notes[1], false);
});

test('normalizeSong throws plain-English messages for unfixable input', () => {
  assert.throws(() => normalizeSong({ title: 'no id' }), /id/);
  assert.throws(() => normalizeSong('nope'), /object/);
  assert.throws(() => normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P' }] }), /notes/);
});

test('normalizeSong result always passes validateSong', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 100, midi: 60 }] }] });
  const { ok, errors } = validateSong(song);
  assert.equal(ok, true, errors.join('; '));
});

// ---- songDurationTicks / barsOf / notesInBar ----

test('songDurationTicks is the latest note end, or 0 when empty', () => {
  assert.equal(songDurationTicks(baseSong()), 1440);
  assert.equal(songDurationTicks(baseSong({ parts: [{ id: 'p', name: 'P', notes: [] }] })), 0);
});

test('barsOf computes bar length from metre and ticksPerQuarter, minimum one bar', () => {
  assert.deepEqual(barsOf(baseSong()), [0, 1920]);
  assert.deepEqual(barsOf(baseSong({ metre: { num: 6, den: 8 } })), [0, 1440]);
  assert.deepEqual(barsOf(baseSong({ parts: [{ id: 'p', name: 'P', notes: [] }] })), [0, 1920]);
});

test('notesInBar returns only notes starting in that bar, tagged with partId', () => {
  const song = baseSong({ parts: [{ id: 'melody', name: 'Melody', notes: [
    { start: 0, dur: 480, midi: 60 }, { start: 1920, dur: 480, midi: 62 }
  ] }] });
  const bar0 = notesInBar(song, 0);
  const bar1 = notesInBar(song, 1);
  assert.equal(bar0.length, 1);
  assert.equal(bar0[0].note.midi, 60);
  assert.equal(bar0[0].partId, 'melody');
  assert.equal(bar1[0].note.midi, 62);
  assert.throws(() => notesInBar(song, -1));
});

// ---- partRange ----

test('partRange returns low/high midi, or nulls when empty', () => {
  assert.deepEqual(partRange(baseSong().parts[0]), { low: 60, high: 67 });
  assert.deepEqual(partRange({ id: 'p', name: 'P', notes: [] }), { low: null, high: null });
});

// ---- transpose ----

test('transpose shifts notes and key without mutating the input, clamps, wraps tonic', () => {
  const song = baseSong();
  const up = transpose(song, 2);
  assert.deepEqual(up.parts[0].notes.map(n => n.midi), [62, 62, 69]);
  assert.equal(up.key.tonic, 2);
  assert.deepEqual(song.parts[0].notes.map(n => n.midi), [60, 60, 67]);

  const nearTop = baseSong({ parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 10, midi: 126 }] }] });
  assert.equal(transpose(nearTop, 10).parts[0].notes[0].midi, 127);

  const down = transpose(baseSong({ key: { tonic: 1, mode: 'major' } }), -3);
  assert.equal(down.key.tonic, 10);

  assert.throws(() => transpose(song, 1.5));
});

// ---- ticksToSeconds ----

test('ticksToSeconds converts at 480 ticks/quarter and rejects a non-positive bpm', () => {
  assert.equal(ticksToSeconds(480, 120), 0.5);
  assert.equal(ticksToSeconds(1920, 120), 2);
  assert.throws(() => ticksToSeconds(480, 0));
});
