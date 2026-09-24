import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songTempoEntries, createSongClock } from '../../src/song/clock.js';
import { exportMidi } from '../../src/song/export-midi.js';
import { importMidi } from '../../src/song/import-midi.js';
import { TICKS_PER_QUARTER } from '../../src/song/model.js';

function song(bpm, tempoMap) {
  return {
    schema: 'song/1', id: 'clock-test', title: 'Clock Test', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [], chords: [], tempoMap,
  };
}

test('a song with no tempoMap is one flat tempo', () => {
  const s = song(120, []);
  const clock = createSongClock(s);
  assert.equal(clock.sec(0, 1920), 2);
  assert.equal(clock.bpmAt(5000), 120);
});

test('a tempo change applies from its tick', () => {
  const s = song(120, [{ tick: 1920, bpm: 60 }]);
  const clock = createSongClock(s);
  assert.equal(clock.sec(0, 3840), 6);
  assert.equal(clock.bpmAt(1919), 120);
  assert.equal(clock.bpmAt(1920), 60);
});

test('a phrase starting after the change is timed at the new tempo', () => {
  const s = song(120, [{ tick: 1920, bpm: 60 }]);
  const clock = createSongClock(s);
  assert.equal(clock.sec(1920, 2400), 1);
});

test('the opening tempo is song.bpm even if tempoMap repeats tick 0 with another value', () => {
  const s = song(100, [{ tick: 0, bpm: 90 }]);
  const clock = createSongClock(s);
  assert.equal(clock.bpmAt(0), 100);
});

test('scale stretches every segment', () => {
  const s = song(120, [{ tick: 1920, bpm: 60 }]);
  const clock = createSongClock(s);
  assert.equal(clock.sec(0, 3840, 0.5), 12);
});

test('tickAfter inverts sec across a change', () => {
  const s = song(120, [{ tick: 1920, bpm: 60 }]);
  const clock = createSongClock(s);
  const sec = clock.sec(0, 2880);
  const tick = clock.tickAfter(0, sec);
  assert.ok(Math.abs(tick - 2880) <= 1, `expected tick close to 2880, got ${tick}`);
});

test('changesBetween lists only changes inside the span', () => {
  const s = song(120, [{ tick: 1920, bpm: 60 }, { tick: 3840, bpm: 90 }]);
  const clock = createSongClock(s);
  assert.deepEqual(clock.changesBetween(0, 2000), [{ tick: 1920, bpm: 60 }]);
  assert.deepEqual(clock.changesBetween(2000, 3000), []);
  // fromTick is exclusive (a change already in effect at fromTick isn't a "new" change within
  // the span), toTick is inclusive.
  assert.deepEqual(clock.changesBetween(1920, 3840), [{ tick: 3840, bpm: 90 }]);
});

test('songTempoEntries ignores a tick-0 tempoMap entry in favour of song.bpm', () => {
  const s = song(100, [{ tick: 0, bpm: 90 }, { tick: 1920, bpm: 60 }]);
  assert.deepEqual(songTempoEntries(s), [{ tick: 0, bpm: 100 }, { tick: 1920, bpm: 60 }]);
});

test('exportMidi keeps the opening tempo when tempoMap holds only changes', () => {
  const s = song(90, [{ tick: 1920, bpm: 120 }]);
  const bytes = exportMidi(s);
  const { song: back } = importMidi(bytes);
  // SMF tempo is stored as integer microseconds-per-quarter-note (see export-midi.test.mjs's
  // round-trip test), so a small tolerance accounts for that quantization.
  assert.ok(Math.abs(back.bpm - 90) < 0.01, `expected opening bpm ~90, got ${back.bpm}`);
});
