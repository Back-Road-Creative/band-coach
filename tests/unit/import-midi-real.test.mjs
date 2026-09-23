import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importMidi } from '../../src/song/import-midi.js';

// Real Standard MIDI Files written by real software, not this repo's own
// hand-built bytes (see tests/unit/import-midi.test.mjs for the synthetic
// coverage). Fixture provenance and licence: tests/fixtures/midi/README.md.
//
// Every expected value below was derived independently of import-midi.js,
// by decoding each file with Python's `mido` library and hand-checking the
// raw meta events. See tests/fixtures/midi/README.md for exactly which
// decode command produced which number.

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'midi');

function loadFixture(name) {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

test('beat.mid: real format-1 drum loop, 120 ppq, SMPTE-offset meta, 390 velocity-0 note-offs', () => {
  const bytes = loadFixture('beat.mid');
  const { song, warnings } = importMidi(bytes, { fileName: 'beat.mid' });

  // `mido.MidiFile('beat.mid')`: type 1, ticks_per_beat 120.
  assert.equal(song.schema, 'song/1');
  assert.equal(song.ticksPerQuarter, 480);
  assert.equal(warnings.length, 0);

  // Conductor track: MetaMessage('track_name', name='untitled'),
  // MetaMessage('set_tempo', tempo=600000) -> 60000000/600000 = 100 bpm,
  // MetaMessage('time_signature', numerator=4, denominator=4),
  // MetaMessage('key_signature', key='C') -> sf=0, mi=0 -> C major.
  // The SMPTE-offset meta event (0x54) on the same track must be safely
  // ignored rather than rejected or mistaken for SMPTE-based *division*.
  assert.equal(song.title, 'untitled');
  assert.equal(song.bpm, 100);
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' });

  // Track 1: name 'Track 1', all 390 notes on channel 9 (percussion).
  // Every note-off in this file is a running-status note-on with velocity
  // 0, at real scale (hundreds of events), not the handful of hand-built
  // ones in import-midi.test.mjs.
  assert.equal(song.parts.length, 1);
  assert.equal(song.parts[0].name, 'Track 1 (percussion)');
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 390);

  // Source ppq 120 -> scale 480/120 = 4. First 12 notes decoded by hand by
  // walking track 1's raw delta-times and matching each velocity-0
  // note-on to the earliest still-open note-on for that pitch (FIFO), then
  // multiplying every tick by 4.
  assert.deepEqual(notes.slice(0, 12), [
    { start: 0, dur: 40, midi: 42 },
    { start: 0, dur: 40, midi: 35 },
    { start: 120, dur: 40, midi: 42 },
    { start: 240, dur: 40, midi: 42 },
    { start: 360, dur: 40, midi: 42 },
    { start: 480, dur: 40, midi: 42 },
    { start: 480, dur: 40, midi: 37 },
    { start: 480, dur: 40, midi: 75 },
    { start: 600, dur: 40, midi: 42 },
    { start: 720, dur: 40, midi: 42 },
    { start: 720, dur: 40, midi: 35 },
    { start: 840, dur: 40, midi: 42 },
  ]);
  assert.deepEqual(notes.slice(-3), [
    { start: 30720, dur: 40, midi: 42 },
    { start: 30720, dur: 40, midi: 35 },
    { start: 30840, dur: 40, midi: 42 },
  ]);

  // No note in a real 390-event percussion loop may come out zero-length
  // or carry an out-of-range MIDI pitch.
  for (const note of notes) {
    assert.ok(note.dur >= 1, `note ${JSON.stringify(note)} has non-positive duration`);
    assert.ok(note.midi >= 0 && note.midi <= 127, `note ${JSON.stringify(note)} has an out-of-range pitch`);
  }
  // Notes must be in non-decreasing start order.
  for (let i = 1; i < notes.length; i++) {
    assert.ok(notes[i].start >= notes[i - 1].start, `note ${i} is out of start order`);
  }
});

test('pitchBendTest.mid: real format-1 file, empty track-name events, no tempo event, real pitch-bend/program-change bytes', () => {
  const bytes = loadFixture('pitchBendTest.mid');
  const { song, warnings } = importMidi(bytes, { fileName: 'pitchBendTest.mid' });

  // `mido.MidiFile('pitchBendTest.mid')`: type 1, ticks_per_beat 480. Both
  // tracks carry an empty-string track-name meta event, which is falsy in
  // JS and must fall back rather than producing an empty title/part name.
  assert.equal(song.title, 'pitchBendTest');
  assert.equal(warnings.length, 0);

  // No set_tempo meta event anywhere in the file -> the documented 120 bpm
  // default, exercised here on a real file rather than a hand-built one.
  assert.equal(song.bpm, 120);
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.equal(song.key, null);

  assert.equal(song.parts.length, 1);
  assert.equal(song.parts[0].name, 'Track 2');

  // Track 1: program_change(channel=1, program=0), note 60 (start 0,
  // velocity 98) then ~28 real pitchwheel (0xE0) events, note-off at raw
  // tick 960, note 72 (start 960) with another ~28 pitchwheel events,
  // note-off at 1920, note 67 (start 1920) with ~55 more pitchwheel
  // events, note-off at 2880. ppq is already 480 so the scale is 1:1.
  assert.deepEqual(song.parts[0].notes, [
    { start: 0, dur: 960, midi: 60 },
    { start: 960, dur: 960, midi: 72 },
    { start: 1920, dur: 960, midi: 67 },
  ]);
});
