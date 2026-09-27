// src/instruments/kbd-songs.js: the keyboard trainer's "Play a song with
// these notes" suggestions. KBD_LEVEL_PITCH_POOLS is the one copy of which
// notes each keyboard level teaches (src/app.js's MODS.kbd levels read it),
// so the trainer and the song hand-off cannot disagree. The checks below
// recompute the taught-pitch pool from a hand-written expectation instead of
// the module's own pool, so a changed curriculum fails here until this file
// is updated on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { starterSongs } from '../../src/song/starter/index.js';
import { ENTRIES, songFor, reviewItems, KBD_LEVEL_PITCH_POOLS } from '../../src/instruments/kbd-songs.js';

// The keyboard levels' own new notes, level 1 first; empty for a level that
// teaches a task rather than new notes (Moves: two notes, Moves: three notes).
const KBD_LEVEL_ADD = [
  [60, 62, 64],
  [65, 67],
  [69, 71, 72],
  [66, 70],
  [61, 63, 68],
  [],
  [],
  [48, 50, 52, 53, 55, 57, 59],
];

function taughtBelow(level) {
  const set = new Set();
  for (let i = 0; i < Math.min(level - 1, KBD_LEVEL_ADD.length); i++) KBD_LEVEL_ADD[i].forEach((p) => set.add(p));
  return set;
}

function pitchesOf(song) {
  const set = new Set();
  song.parts.forEach((part) => part.notes.forEach((n) => set.add(n.midi)));
  return Array.from(set);
}

test('the shared level pools match the keyboard curriculum', () => {
  assert.deepEqual(KBD_LEVEL_PITCH_POOLS, KBD_LEVEL_ADD);
});

test('every entry names a real starter song', () => {
  assert.ok(ENTRIES.length > 0, 'expected at least one hand-off entry');
  for (const entry of ENTRIES) assert.ok(starterSongs.some((s) => s.id === entry.songId), entry.songId + ' should exist in starterSongs');
});

test("every entry's song pitches are fully taught by the levels below its minLevel", () => {
  for (const entry of ENTRIES) {
    const song = starterSongs.find((s) => s.id === entry.songId);
    const pool = taughtBelow(entry.minLevel);
    const pitches = pitchesOf(song);
    for (const p of pitches) assert.ok(pool.has(p), entry.songId + ': pitch ' + p + ' is not taught below level ' + entry.minLevel);
  }
});

test('songFor(1) is null: no song is ever offered before any level is passed', () => {
  assert.equal(songFor(1), null);
});

test("songFor(2) is Hot Cross Buns", () => {
  const entry = songFor(2);
  assert.ok(entry, 'expected a hand-off entry at level 2');
  assert.equal(entry.songId, 'hot-cross-buns');
});

test('songFor(level) is the most advanced song already reached, first-listed on a tie', () => {
  for (let level = 1; level <= 14; level++) {
    const reached = ENTRIES.filter((e) => e.minLevel <= level);
    const got = songFor(level);
    if (!reached.length) { assert.equal(got, null, 'level ' + level); continue; }
    const top = Math.max(...reached.map((e) => e.minLevel));
    assert.equal(got, reached.find((e) => e.minLevel === top), 'level ' + level);
  }
});

test('every reviewItems() entry is unreviewed (the ledger ships empty)', () => {
  const items = reviewItems();
  assert.ok(items.length > 0);
  for (const item of items) assert.equal(item.current, false, item.id + ' should read as unreviewed');
});
