// Additive Song model fields: tempoMap, metreChanges, keyChanges, note
// velocity, part role/instrumentHint. Every field here is OPTIONAL -- a song
// without them validates and normalizes exactly as it did before this file
// existed (see the deep-equal test below against every starter song).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA, TICKS_PER_QUARTER, MODES, ROLES, validateSong, normalizeSong, transpose
} from '../../src/song/model.js';
import { starterSongs } from '../../src/song/starter/index.js';

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

// ---- old songs unchanged -----------------------------------------------

test('a song with none of the new fields normalizes to exactly what it did before', () => {
  for (const song of starterSongs) {
    // `level` is a Band-Coach convenience field on starterSongs, not part of
    // the shared Song shape (see src/song/starter/index.js) -- normalizeSong
    // has always stripped it, unrelated to the additive fields under test.
    const { level, ...shared } = song;
    const stripped = JSON.parse(JSON.stringify(song));
    const normalized = normalizeSong(stripped);
    assert.deepEqual(normalized, shared, `${song.id}: normalization changed with no additive fields present`);
  }
});

// ---- tempoMap -----------------------------------------------------------

test('validateSong accepts a well-formed tempoMap and rejects a malformed one', () => {
  const good = baseSong({ tempoMap: [{ tick: 0, bpm: 100 }, { tick: 1920, bpm: 140 }] });
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const unsorted = baseSong({ tempoMap: [{ tick: 1920, bpm: 140 }, { tick: 0, bpm: 100 }] });
  assert.ok(validateSong(unsorted).errors.some(e => e.includes('tempoMap') && e.includes('sorted')));

  const badTick = baseSong({ tempoMap: [{ tick: -1, bpm: 100 }] });
  assert.ok(badTick.tempoMap && validateSong(badTick).errors.some(e => e.includes('tempoMap') && e.includes('tick')));

  const badBpm = baseSong({ tempoMap: [{ tick: 0, bpm: 0 }] });
  assert.ok(validateSong(badBpm).errors.some(e => e.includes('tempoMap') && e.includes('bpm')));

  const notArray = baseSong({ tempoMap: 'nope' });
  assert.ok(validateSong(notArray).errors.some(e => e.includes('tempoMap')));
});

test('normalizeSong passes a well-formed tempoMap through untouched and throws for a bad one', () => {
  const raw = { id: 'x', parts: [], chords: [], tempoMap: [{ tick: 0, bpm: 90 }, { tick: 960, bpm: 110 }] };
  const song = normalizeSong(raw);
  assert.deepEqual(song.tempoMap, [{ tick: 0, bpm: 90 }, { tick: 960, bpm: 110 }]);

  assert.throws(() => normalizeSong({ id: 'x', parts: [], tempoMap: [{ tick: 0, bpm: -5 }] }), /tempoMap/);
  assert.throws(() => normalizeSong({ id: 'x', parts: [], tempoMap: [{ tick: 960, bpm: 90 }, { tick: 0, bpm: 110 }] }), /tempoMap/);
});

// ---- metreChanges --------------------------------------------------------

test('validateSong accepts well-formed metreChanges and rejects bad ones', () => {
  const good = baseSong({ metreChanges: [{ tick: 1920, num: 3, den: 4 }] });
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const unsorted = baseSong({ metreChanges: [{ tick: 1920, num: 3, den: 4 }, { tick: 0, num: 6, den: 8 }] });
  assert.ok(validateSong(unsorted).errors.some(e => e.includes('metreChanges') && e.includes('sorted')));

  const badDen = baseSong({ metreChanges: [{ tick: 0, num: 3, den: 3 }] });
  assert.ok(validateSong(badDen).errors.some(e => e.includes('metreChanges') && e.includes('den')));

  const badNum = baseSong({ metreChanges: [{ tick: 0, num: 0, den: 4 }] });
  assert.ok(validateSong(badNum).errors.some(e => e.includes('metreChanges') && e.includes('num')));
});

test('normalizeSong passes well-formed metreChanges through and throws for a bad one', () => {
  const song = normalizeSong({ id: 'x', parts: [], chords: [], metreChanges: [{ tick: 960, num: 3, den: 4 }] });
  assert.deepEqual(song.metreChanges, [{ tick: 960, num: 3, den: 4 }]);
  assert.throws(() => normalizeSong({ id: 'x', parts: [], metreChanges: [{ tick: 0, num: 0, den: 4 }] }), /metreChanges/);
});

// ---- keyChanges -----------------------------------------------------------

test('validateSong accepts well-formed keyChanges and rejects bad ones', () => {
  const good = baseSong({ keyChanges: [{ tick: 1920, tonic: 7, mode: 'minor' }] });
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const unsorted = baseSong({ keyChanges: [{ tick: 1920, tonic: 7, mode: 'minor' }, { tick: 0, tonic: 2, mode: 'major' }] });
  assert.ok(validateSong(unsorted).errors.some(e => e.includes('keyChanges') && e.includes('sorted')));

  const badTonic = baseSong({ keyChanges: [{ tick: 0, tonic: 20, mode: 'major' }] });
  assert.ok(validateSong(badTonic).errors.some(e => e.includes('keyChanges') && e.includes('tonic')));

  const badMode = baseSong({ keyChanges: [{ tick: 0, tonic: 0, mode: 'dorian' }] });
  assert.ok(validateSong(badMode).errors.some(e => e.includes('keyChanges') && e.includes('mode')));
});

test('normalizeSong passes well-formed keyChanges through and throws for a bad one', () => {
  const song = normalizeSong({ id: 'x', parts: [], chords: [], keyChanges: [{ tick: 960, tonic: 5, mode: 'minor' }] });
  assert.deepEqual(song.keyChanges, [{ tick: 960, tonic: 5, mode: 'minor' }]);
  assert.throws(() => normalizeSong({ id: 'x', parts: [], keyChanges: [{ tick: 0, tonic: 0, mode: 'dorian' }] }), /keyChanges/);
});

test('transpose shifts keyChanges tonics consistently with the base key', () => {
  const song = baseSong({ key: { tonic: 0, mode: 'major' }, keyChanges: [{ tick: 960, tonic: 7, mode: 'minor' }] });
  const up = transpose(song, 3);
  assert.equal(up.key.tonic, 3);
  assert.equal(up.keyChanges[0].tonic, 10);
  assert.equal(up.keyChanges[0].mode, 'minor');
  assert.equal(up.keyChanges[0].tick, 960);
  // input untouched
  assert.equal(song.keyChanges[0].tonic, 7);
});

// ---- note velocity --------------------------------------------------------

test('validateSong enforces note velocity range 1-127', () => {
  const good = baseSong(); good.parts[0].notes[0].velocity = 100;
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const zero = baseSong(); zero.parts[0].notes[0].velocity = 0;
  assert.ok(validateSong(zero).errors.some(e => e.includes('velocity')));

  const tooHigh = baseSong(); tooHigh.parts[0].notes[0].velocity = 200;
  assert.ok(validateSong(tooHigh).errors.some(e => e.includes('velocity')));

  const fractional = baseSong(); fractional.parts[0].notes[0].velocity = 64.5;
  assert.ok(validateSong(fractional).errors.some(e => e.includes('velocity')));
});

test('normalizeSong keeps a valid velocity and throws for an out-of-range one', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 100, midi: 60, velocity: 90 }
  ] }] });
  assert.equal(song.parts[0].notes[0].velocity, 90);
  assert.throws(() => normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 100, midi: 60, velocity: 0 }
  ] }] }), /velocity/);
});

// ---- part role / instrumentHint --------------------------------------------

test('ROLES lists the valid part roles', () => {
  assert.deepEqual(ROLES, ['melody', 'bass', 'inner', 'percussion']);
});

test('validateSong enforces part.role and part.instrumentHint', () => {
  const good = baseSong();
  good.parts[0].role = 'melody';
  good.parts[0].instrumentHint = 'trumpet';
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const badRole = baseSong(); badRole.parts[0].role = 'lead';
  assert.ok(validateSong(badRole).errors.some(e => e.includes('role')));

  const badHint = baseSong(); badHint.parts[0].instrumentHint = 42;
  assert.ok(validateSong(badHint).errors.some(e => e.includes('instrumentHint')));
});

test('normalizeSong keeps a valid part role/instrumentHint and throws for a bad role', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', role: 'bass', instrumentHint: 'bass guitar', notes: [
    { start: 0, dur: 100, midi: 40 }
  ] }] });
  assert.equal(song.parts[0].role, 'bass');
  assert.equal(song.parts[0].instrumentHint, 'bass guitar');
  assert.throws(() => normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', role: 'lead', notes: [
    { start: 0, dur: 100, midi: 40 }
  ] }] }), /role/);
});

// ---- round-trip -----------------------------------------------------------

test('a song using every new field survives a JSON round-trip through normalizeSong unchanged', () => {
  const song = normalizeSong({
    schema: SCHEMA, id: 'full', title: 'Full Song', composer: null, licence: null, source: null,
    key: { tonic: 2, mode: 'minor' }, metre: { num: 3, den: 4 }, bpm: 96, ticksPerQuarter: TICKS_PER_QUARTER,
    tempoMap: [{ tick: 0, bpm: 96 }, { tick: 1440, bpm: 120 }],
    metreChanges: [{ tick: 1440, num: 4, den: 4 }],
    keyChanges: [{ tick: 1440, tonic: 5, mode: 'major' }],
    parts: [{ id: 'melody', name: 'Melody', role: 'melody', instrumentHint: 'flute', notes: [
      { start: 0, dur: 480, midi: 62, velocity: 80 }, { start: 480, dur: 480, midi: 65, velocity: 100 }
    ] }, { id: 'bass', name: 'Bass', role: 'bass', notes: [
      { start: 0, dur: 960, midi: 38, velocity: 70 }
    ] }],
    chords: [{ start: 0, symbol: 'Dm' }]
  });

  const roundTripped = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.deepEqual(roundTripped, song);
});
