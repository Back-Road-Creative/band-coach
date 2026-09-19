import test from 'node:test';
import assert from 'node:assert/strict';

import { parse, barTicks, metreTicks } from '../../src/song/starter/notation.js';

const META = {
  id: 'test-tune',
  title: 'Test Tune',
  composer: 'Traditional',
  licence: 'Public domain',
  source: 'Synthetic fixture for notation.js unit tests.',
  key: { tonic: 0, mode: 'major' },
  metre: { num: 4, den: 4 },
  bpm: 100,
  level: 1,
};

test('metreTicks computes ticks per bar from num/den', () => {
  assert.equal(metreTicks({ num: 4, den: 4 }), 1920);
  assert.equal(metreTicks({ num: 3, den: 4 }), 1440);
  assert.equal(metreTicks({ num: 6, den: 8 }), 1440);
});

test('parse builds a shared-shape Song from simple quarter notes', () => {
  const song = parse('C4:q D4:q E4:q F4:q', META);
  assert.equal(song.schema, 'song/1');
  assert.equal(song.id, 'test-tune');
  assert.equal(song.ticksPerQuarter, 480);
  assert.equal(song.parts.length, 1);
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 4);
  assert.deepEqual(
    notes.map((n) => n.midi),
    [60, 62, 64, 65]
  );
  assert.deepEqual(
    notes.map((n) => n.start),
    [0, 480, 960, 1440]
  );
  assert.deepEqual(
    notes.map((n) => n.dur),
    [480, 480, 480, 480]
  );
});

test('parse handles half/whole notes and dotted durations', () => {
  const song = parse('C4:h D4:q. E4:e', META);
  const notes = song.parts[0].notes;
  assert.deepEqual(
    notes.map((n) => n.dur),
    [960, 720, 240]
  );
  assert.deepEqual(
    notes.map((n) => n.start),
    [0, 960, 1680]
  );
});

test('rests advance the cursor without emitting a note', () => {
  const song = parse('C4:q R:q D4:q R:q', META);
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 2);
  assert.equal(notes[0].start, 0);
  assert.equal(notes[1].start, 960);
});

test('a trailing ~ ties the next same-pitch note', () => {
  const song = parse('C4:h~ C4:q R:q', META);
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 2);
  assert.equal(notes[0].tieFromPrev, undefined);
  assert.equal(notes[1].tieFromPrev, true);
  assert.equal(notes[1].midi, 60);
});

test('a tie into a different pitch is rejected', () => {
  assert.throws(() => parse('C4:h~ D4:q R:q', META), /tie/i);
});

test('accidentals shift the midi number', () => {
  const song = parse('C4:q C#4:q Db4:q R:q', META);
  assert.deepEqual(
    song.parts[0].notes.map((n) => n.midi),
    [60, 61, 61]
  );
});

test('bars must sum to the metre', () => {
  assert.throws(() => parse('C4:q D4:q', META), /sums to/);
});

test('a pickup bar pairs with the last bar to complete one metre unit', () => {
  const song = parse('^ G4:q | C4:h D4:h | D4:h.', META);
  // sanity: this should not throw even though the pickup and last bars are
  // individually short of the metre, because together they sum to one bar
  // (480 + 1440 = 1920), while the middle bar sums to a full 1920 alone.
  assert.ok(song.parts[0].notes.length > 0);
});

test('barTicks reports the pickup flag and each bar length', () => {
  const result = barTicks('^ G4:q | C4:h D4:h');
  assert.equal(result.pickup, true);
  assert.deepEqual(result.bars, [480, 1920]);
});

test('an unrecognised token raises a clear error', () => {
  assert.throws(() => parse('C4:q ZZZ', META), /unrecognised token/);
});
