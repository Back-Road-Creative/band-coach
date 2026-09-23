import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importGp5 } from '../../src/song/import-gp5.js';
import { validateSong } from '../../src/song/model.js';

// Real Guitar Pro 5 files, unlike the synthetic byte streams in
// import-gp5.test.mjs, actually exercise the format Guitar Pro itself
// writes. See tests/fixtures/gp5/README.md for exact source/license per
// file. Every expected value below was read independently with
// PyGuitarPro (`pip install pyguitarpro`, LGPL-3.0), never derived from
// this repo's own parser -- so a passing test here is real evidence the
// parser reads the real format, not just its own idea of the format.

function fixture(name) {
  const path = fileURLToPath(new URL(`../fixtures/gp5/${name}`, import.meta.url));
  return new Uint8Array(readFileSync(path));
}

test('tuplets.gp5: reads two different tuplet ratios correctly (triplet and quintuplet)', () => {
  const { song, warnings } = importGp5(fixture('tuplets.gp5'), { fileName: 'tuplets.gp5' });

  assert.equal(song.metre.num, 4);
  assert.equal(song.metre.den, 4);
  assert.deepEqual(warnings, []);

  const part = song.parts.find((p) => p.name.includes('string 5'));
  assert.ok(part, `expected a part for string 5, got: ${song.parts.map((p) => p.name).join(', ')}`);

  // measure 1: a triplet -- 3 quarter notes in the time of 2 (320 ticks each)
  const triplet = part.notes.slice(0, 3);
  assert.deepEqual(triplet.map((n) => n.midi), [48, 48, 48]); // tuning[4]=45, fret 3
  assert.deepEqual(triplet.map((n) => n.start), [0, 320, 640]);
  assert.deepEqual(triplet.map((n) => n.dur), [320, 320, 320]);

  // measure 2: a quintuplet -- 5 quarter notes in the time of 4 (384 ticks each),
  // NOT the 2/n ratio that only happens to be correct for triplets
  const quintuplet = part.notes.slice(3, 8);
  assert.deepEqual(quintuplet.map((n) => n.midi), [46, 46, 46, 46, 46]); // fret 1
  assert.deepEqual(quintuplet.map((n) => n.start), [960, 1344, 1728, 2112, 2496]);
  assert.deepEqual(quintuplet.map((n) => n.dur), [384, 384, 384, 384, 384]);

  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
});

test('multitrack.gp5: reads three track headers without desyncing the byte stream', () => {
  const { song, warnings } = importGp5(fixture('multitrack.gp5'), { fileName: 'multitrack.gp5' });

  assert.equal(song.metre.num, 4);
  assert.equal(song.metre.den, 4);
  assert.deepEqual(warnings, []);
  // all three tracks' single measure is silent in this fixture, so there
  // is nothing to surface as a part -- but getting here at all (instead of
  // throwing "unexpected end of file" partway through the second or third
  // track header) is the evidence that track-header parsing stayed
  // byte-aligned across all three tracks.
  assert.deepEqual(song.parts, []);

  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
});

test('Voices.gp5: reads the primary voice and discards the secondary voice without desync', () => {
  const { song, warnings } = importGp5(fixture('Voices.gp5'), { fileName: 'Voices.gp5' });

  assert.equal(song.metre.num, 4);
  assert.equal(song.metre.den, 4);
  assert.deepEqual(warnings, []);

  const part = song.parts.find((p) => p.name.includes('string 6'));
  assert.ok(part, `expected a part for string 6, got: ${song.parts.map((p) => p.name).join(', ')}`);

  // measure 1, voice 1 (primary): four quarter notes, frets 1-4 on string 6
  const quarters = part.notes.slice(0, 4);
  assert.deepEqual(quarters.map((n) => n.midi), [41, 42, 43, 44]);
  assert.deepEqual(quarters.map((n) => n.start), [0, 480, 960, 1440]);
  assert.deepEqual(quarters.map((n) => n.dur), [480, 480, 480, 480]);

  // measure 2, voice 1: one whole note, fret 8 -- its start time follows
  // directly from voice 1's own running total, unaffected by voice 2's
  // (different, dotted-note) durations in measure 1.
  const whole = part.notes[4];
  assert.equal(whole.midi, 48);
  assert.equal(whole.start, 1920);
  assert.equal(whole.dur, 1920);

  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
});

test('Repeat.gp5: reads a fast tempo and repeat-open/repeat-close flags across eight measures', () => {
  const { song, warnings } = importGp5(fixture('Repeat.gp5'), { fileName: 'Repeat.gp5' });

  assert.equal(song.bpm, 400);
  assert.equal(song.metre.num, 4);
  assert.equal(song.metre.den, 4);
  assert.deepEqual(warnings, []);
  // every measure in this fixture is silent; getting a fully-formed song
  // back (rather than throwing partway through the repeat-flag measure
  // headers) is the evidence those flags were parsed correctly.
  assert.deepEqual(song.parts, []);

  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
});
