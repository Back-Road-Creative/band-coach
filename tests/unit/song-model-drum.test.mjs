// Additive Song model fields for drum-kit lessons (U4): note.piece and
// part.unmapped. Both optional -- a song without them normalizes exactly as
// it did before (covered already by song-model-additive.test.mjs's starter
// song round-trip; this file only exercises the two new fields).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA, TICKS_PER_QUARTER, validateSong, normalizeSong } from '../../src/song/model.js';

function baseSong(overrides = {}) {
  return {
    schema: SCHEMA, id: 'drums', title: 'Drums', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [
      { start: 0, dur: 240, midi: 38, piece: 'snare' }, { start: 240, dur: 240, midi: 39, piece: null }
    ] }],
    chords: [],
    ...overrides
  };
}

// ---- note.piece ------------------------------------------------------

test('validateSong accepts a string or null note.piece and rejects anything else', () => {
  const good = baseSong();
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const bad = baseSong();
  bad.parts[0].notes[0].piece = 42;
  assert.ok(validateSong(bad).errors.some(e => e.includes('piece')));
});

test('normalizeSong keeps a valid note.piece and throws for a non-string non-null one', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 100, midi: 38, piece: 'snare' }
  ] }] });
  assert.equal(song.parts[0].notes[0].piece, 'snare');

  const withNull = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 100, midi: 39, piece: null }
  ] }] });
  assert.equal(withNull.parts[0].notes[0].piece, null);

  assert.throws(() => normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', notes: [
    { start: 0, dur: 100, midi: 38, piece: 7 }
  ] }] }), /piece/);
});

// ---- part.unmapped -----------------------------------------------------

test('validateSong accepts a non-negative integer part.unmapped and rejects anything else', () => {
  const good = baseSong(); good.parts[0].unmapped = 1;
  assert.equal(validateSong(good).ok, true, validateSong(good).errors.join('; '));

  const negative = baseSong(); negative.parts[0].unmapped = -1;
  assert.ok(validateSong(negative).errors.some(e => e.includes('unmapped')));

  const fractional = baseSong(); fractional.parts[0].unmapped = 1.5;
  assert.ok(validateSong(fractional).errors.some(e => e.includes('unmapped')));
});

test('normalizeSong keeps a valid part.unmapped and throws for a bad one', () => {
  const song = normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', role: 'percussion', unmapped: 2, notes: [
    { start: 0, dur: 100, midi: 39, piece: null }
  ] }] });
  assert.equal(song.parts[0].unmapped, 2);

  assert.throws(() => normalizeSong({ id: 'x', parts: [{ id: 'p', name: 'P', unmapped: -1, notes: [
    { start: 0, dur: 100, midi: 39 }
  ] }] }), /unmapped/);
});

// ---- round-trip ---------------------------------------------------------

test('a percussion part with piece and unmapped survives a JSON round-trip through normalizeSong unchanged', () => {
  const song = normalizeSong(baseSong({ parts: [{ id: 'kit', name: 'Kit', role: 'percussion', unmapped: 1, notes: [
    { start: 0, dur: 240, midi: 38, piece: 'snare' }, { start: 240, dur: 240, midi: 39, piece: null }
  ] }] }));
  const roundTripped = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.deepEqual(roundTripped, song);
});
