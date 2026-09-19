import test from 'node:test';
import assert from 'node:assert/strict';

import { starterSongs, starterSongDefs } from '../../src/song/starter/index.js';
import { barTicks, metreTicks } from '../../src/song/starter/notation.js';

// Opening-note semitone offsets from each tune's very first note, worked out
// by hand from the note LETTERS/octaves (not by reading parser output), so a
// typo in a notation string (wrong octave digit, wrong letter) shows up as a
// mismatch here instead of silently shipping. C4=60, D4=62, E4=64, F4=65,
// G4=67, A4=69, B4=71; G3=55.
const EXPECTED_OPENING_INTERVALS = {
  'hot-cross-buns': [0, -2, -4],
  'mary-had-a-little-lamb': [0, -2, -4, -2],
  'twinkle-twinkle': [0, 0, 7, 7],
  'frere-jacques': [0, 2, 4, 0, 0, 2, 4, 0, 4, 5, 7, 4, 5, 7, 7, 9, 7, 5, 4, 0],
  'au-clair-de-la-lune': [0, 0, 0, 2, 4, 2, 0, 4, 2, 2, 0],
  'london-bridge': [0, 2, 0, -2, -3, -2, 0, -5, -3, -2, -3, -2, 0],
  'ode-to-joy': [0, 0, 1, 3, 3, 1, 0, -2, -4, -4, -2, 0, 0, -2, -2],
  'amazing-grace': [0, 5, 9, 5, 9, 7, 5, 2, 0],
  'minuet-in-g': [0, -7, -5, -3, -2, 0, -7, -7, 2],
};

// The floor is 8, not 12: six tunes typed from memory could not be vouched for
// note-for-note and were removed rather than shipped wrong. Add a tune only
// after checking it against the melody itself.
test('starter library has between 8 and 15 tunes', () => {
  assert.ok(starterSongs.length >= 8, `expected >=8 tunes, got ${starterSongs.length}`);
  assert.ok(starterSongs.length <= 15, `expected <=15 tunes, got ${starterSongs.length}`);
  assert.equal(starterSongs.length, starterSongDefs.length);
});

test('every tune parses to the shared song/1 shape', () => {
  for (const song of starterSongs) {
    assert.equal(song.schema, 'song/1');
    assert.equal(song.ticksPerQuarter, 480);
    assert.ok(typeof song.id === 'string' && song.id.length > 0);
    assert.ok(typeof song.title === 'string' && song.title.length > 0);
    assert.ok(Array.isArray(song.parts) && song.parts.length >= 1);
    assert.ok(song.parts[0].notes.length > 0);
    assert.ok(Array.isArray(song.chords));
    // notes must be sorted by start
    const starts = song.parts[0].notes.map((n) => n.start);
    const sorted = [...starts].sort((a, b) => a - b);
    assert.deepEqual(starts, sorted, `${song.id}: notes not sorted by start`);
  }
});

test('every tune has a non-empty licence and source', () => {
  for (const song of starterSongs) {
    assert.ok(
      typeof song.licence === 'string' && song.licence.trim().length > 0,
      `${song.id}: missing licence`
    );
    assert.ok(
      typeof song.source === 'string' && song.source.trim().length > 0,
      `${song.id}: missing source`
    );
  }
});

test('licence is Public domain for every tune', () => {
  for (const song of starterSongs) {
    assert.equal(song.licence, 'Public domain', `${song.id}: unexpected licence`);
  }
});

test('every bar sums to the metre; a pickup bar pairs with the last bar', () => {
  for (const def of starterSongDefs) {
    const { pickup, bars } = barTicks(def.notation);
    const metre = metreTicks(def.metre);
    if (pickup) {
      assert.ok(bars.length >= 2, `${def.id}: pickup tune needs at least 2 bars`);
      const combined = bars[0] + bars[bars.length - 1];
      assert.equal(combined, metre, `${def.id}: pickup + last bar should equal one metre unit`);
      for (let i = 1; i < bars.length - 1; i++) {
        assert.equal(bars[i], metre, `${def.id}: bar ${i + 1} does not sum to the metre`);
      }
    } else {
      bars.forEach((sum, i) => {
        assert.equal(sum, metre, `${def.id}: bar ${i + 1} does not sum to the metre`);
      });
    }
  }
});

test('tune ids are unique', () => {
  const ids = starterSongs.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('range is at most a tenth (16 semitones) for level 1-2 tunes', () => {
  for (const song of starterSongs) {
    if (song.level > 2) continue;
    const midis = song.parts[0].notes.map((n) => n.midi);
    const range = Math.max(...midis) - Math.min(...midis);
    assert.ok(range <= 16, `${song.id}: level ${song.level} range is ${range} semitones, expected <= 16`);
  }
});

test('opening notes match independently hand-checked semitone intervals', () => {
  for (const song of starterSongs) {
    const expected = EXPECTED_OPENING_INTERVALS[song.id];
    assert.ok(expected, `${song.id}: no expected interval sequence in the test fixture`);
    const midis = song.parts[0].notes.slice(0, expected.length).map((n) => n.midi);
    const first = midis[0];
    const actual = midis.map((m) => m - first);
    assert.deepEqual(actual, expected, `${song.id}: opening interval sequence mismatch`);
  }
});

test('tunes are graded easiest first (level is non-decreasing)', () => {
  const levels = starterSongs.map((s) => s.level);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] >= levels[i - 1] - 0, `${starterSongs[i].id}: level regresses out of order`);
  }
  // at least one level-1 tune exists and it precedes any level-4 tune
  const firstLevel = levels[0];
  assert.equal(firstLevel, 1, 'first tune should be the easiest (level 1)');
});
