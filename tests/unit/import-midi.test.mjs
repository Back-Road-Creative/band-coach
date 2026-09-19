import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMidi } from '../../src/song/import-midi.js';

// --- tiny MIDI byte-writer helper, local to this test file (no binary fixtures) ---

function u16(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function vlq(n) {
  let buffer = n & 0x7f;
  const bytes = [];
  n >>= 7;
  while (n > 0) {
    buffer <<= 8;
    buffer |= (n & 0x7f) | 0x80;
    n >>= 7;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function chunk(type, bytes) {
  return [...type.split('').map((c) => c.charCodeAt(0)), ...u32(bytes.length), ...bytes];
}

function header({ format = 0, ntrks = 1, ppq = 480 } = {}) {
  return chunk('MThd', [...u16(format), ...u16(ntrks), ...u16(ppq)]);
}

function trackNameEvent(name) {
  const bytes = [...name].map((c) => c.charCodeAt(0));
  return [0x00, 0xff, 0x03, ...vlq(bytes.length), ...bytes];
}

function tempoEvent(bpm, deltaTicks = 0) {
  const micros = Math.round(60000000 / bpm);
  return [...vlq(deltaTicks), 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff];
}

function timeSigEvent(num, denPower, deltaTicks = 0) {
  return [...vlq(deltaTicks), 0xff, 0x58, 0x04, num, denPower, 24, 8];
}

function keySigEvent(sf, mi, deltaTicks = 0) {
  const sfByte = sf < 0 ? sf + 256 : sf;
  return [...vlq(deltaTicks), 0xff, 0x59, 0x02, sfByte, mi];
}

function noteOn(deltaTicks, channel, pitch, velocity = 100) {
  return [...vlq(deltaTicks), 0x90 | channel, pitch, velocity];
}

function noteOnRunning(deltaTicks, pitch, velocity) {
  return [...vlq(deltaTicks), pitch, velocity];
}

function noteOff(deltaTicks, channel, pitch, velocity = 64) {
  return [...vlq(deltaTicks), 0x80 | channel, pitch, velocity];
}

function endOfTrack(deltaTicks = 0) {
  return [...vlq(deltaTicks), 0xff, 0x2f, 0x00];
}

function track(events) {
  return chunk('MTrk', events.flat());
}

function midiFile(headerOpts, trackEventLists) {
  const bytes = [...header(headerOpts), ...trackEventLists.flatMap((events) => track(events))];
  return new Uint8Array(bytes);
}

// --- tests ---

test('format 0: single track, one note', () => {
  const events = [trackNameEvent('Solo'), noteOn(0, 0, 60), noteOff(480, 0, 60), endOfTrack(0)];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song, warnings } = importMidi(bytes, { fileName: 'solo.mid' });

  assert.equal(warnings.length, 0);
  assert.equal(song.schema, 'song/1');
  assert.equal(song.ticksPerQuarter, 480);
  assert.equal(song.parts.length, 1);
  assert.equal(song.parts[0].name, 'Solo');
  assert.deepEqual(song.parts[0].notes, [{ start: 0, dur: 480, midi: 60 }]);
});

test('format 1: multiple tracks, tempo/time/key on the conductor track', () => {
  const conductor = [
    trackNameEvent('Two Voices'),
    tempoEvent(90),
    timeSigEvent(3, 2), // 3/4
    keySigEvent(2, 0), // D major
    endOfTrack(0),
  ];
  const melody = [trackNameEvent('Melody'), noteOn(0, 0, 62), noteOff(240, 0, 62), endOfTrack(0)];
  const bass = [trackNameEvent('Bass'), noteOn(0, 1, 38), noteOff(240, 1, 38), endOfTrack(0)];
  const bytes = midiFile({ format: 1, ntrks: 3, ppq: 480 }, [conductor, melody, bass]);

  const { song, warnings } = importMidi(bytes, { fileName: 'two-voices.mid' });

  assert.equal(warnings.length, 0);
  // Tempo round-trips through an integer microseconds-per-quarter value in
  // the MIDI file itself, so exact bpm recovery is not guaranteed.
  assert.ok(Math.abs(song.bpm - 90) < 0.01, `expected ~90 bpm, got ${song.bpm}`);
  assert.deepEqual(song.metre, { num: 3, den: 4 });
  assert.deepEqual(song.key, { tonic: 2, mode: 'major' });
  assert.equal(song.title, 'Two Voices');
  assert.equal(song.parts.length, 2);
  assert.equal(song.parts[0].name, 'Melody');
  assert.equal(song.parts[1].name, 'Bass');
});

test('running status: note-on/note-off share a status byte across events', () => {
  const events = [
    [...vlq(0), 0x90, 60, 100], // explicit note-on ch0
    noteOnRunning(240, 60, 0), // running status note-on, velocity 0 = note-off
    noteOnRunning(0, 64, 100), // running status note-on
    noteOnRunning(240, 64, 0), // running status note-off
    endOfTrack(0),
  ];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song } = importMidi(bytes);

  assert.equal(song.parts.length, 1);
  assert.deepEqual(song.parts[0].notes, [
    { start: 0, dur: 240, midi: 60 },
    { start: 240, dur: 240, midi: 64 },
  ]);
});

test('overlapping same-pitch notes are matched FIFO', () => {
  const events = [
    noteOn(0, 0, 60),
    noteOn(120, 0, 60), // second note-on for same pitch before the first note-off
    noteOff(120, 0, 60), // closes the FIRST note-on (FIFO)
    noteOff(120, 0, 60), // closes the second
    endOfTrack(0),
  ];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song } = importMidi(bytes);

  assert.equal(song.parts[0].notes.length, 2);
  assert.deepEqual(song.parts[0].notes[0], { start: 0, dur: 240, midi: 60 });
  assert.deepEqual(song.parts[0].notes[1], { start: 120, dur: 240, midi: 60 });
});

test('percussion channel 10 is marked in the part name', () => {
  const events = [noteOn(0, 9, 38), noteOff(120, 9, 38), endOfTrack(0)];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song } = importMidi(bytes);

  assert.match(song.parts[0].name, /percussion/);
});

test('a second tempo event is ignored and produces a warning', () => {
  const events = [
    ...tempoEvent(120),
    ...noteOn(0, 0, 60),
    ...tempoEvent(200, 240),
    ...noteOff(240, 0, 60),
    ...endOfTrack(0),
  ];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song, warnings } = importMidi(bytes);

  assert.equal(song.bpm, 120);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tempo/i);
});

test('rescales PPQ 96 to 480 ticks per quarter', () => {
  const events = [noteOn(0, 0, 60), noteOff(96, 0, 60), endOfTrack(0)];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 96 }, [events]);
  const { song } = importMidi(bytes);

  assert.equal(song.ticksPerQuarter, 480);
  assert.deepEqual(song.parts[0].notes[0], { start: 0, dur: 480, midi: 60 });
});

test('rescales PPQ 960 to 480 ticks per quarter, never producing a zero-length note', () => {
  const events = [noteOn(0, 0, 60), noteOff(1, 0, 60), endOfTrack(0)];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 960 }, [events]);
  const { song } = importMidi(bytes);

  assert.equal(song.ticksPerQuarter, 480);
  assert.equal(song.parts[0].notes[0].start, 0);
  assert.ok(song.parts[0].notes[0].dur >= 1, 'duration must never round to zero');
});

test('a file with no note events imports cleanly with zero parts', () => {
  const events = [trackNameEvent('Just Metadata'), tempoEvent(100), endOfTrack(0)];
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 480 }, [events]);
  const { song, warnings } = importMidi(bytes);

  assert.equal(song.parts.length, 0);
  assert.equal(warnings.length, 0);
  assert.equal(song.bpm, 100);
});

test('format 2 is rejected with a plain-English error', () => {
  const bytes = midiFile({ format: 2, ntrks: 1, ppq: 480 }, [[endOfTrack(0)]]);
  assert.throws(() => importMidi(bytes), /format 2/i);
});

test('SMPTE time division is rejected with a plain-English error', () => {
  const bytes = midiFile({ format: 0, ntrks: 1, ppq: 0x8018 }, [[endOfTrack(0)]]);
  assert.throws(() => importMidi(bytes), /smpte/i);
});

test('every prefix of a valid multi-track file either imports or throws cleanly', () => {
  const conductor = [trackNameEvent('Fuzz'), tempoEvent(120), timeSigEvent(4, 2), endOfTrack(0)];
  const melody = [
    noteOn(0, 0, 60),
    noteOn(60, 0, 64),
    noteOff(60, 0, 60),
    noteOff(60, 0, 64),
    endOfTrack(0),
  ];
  const full = midiFile({ format: 1, ntrks: 2, ppq: 480 }, [conductor, melody]);

  let thrown = 0;
  let imported = 0;
  for (let len = 0; len <= full.length; len++) {
    const prefix = full.subarray(0, len);
    try {
      importMidi(prefix);
      imported++;
    } catch (err) {
      assert.ok(err instanceof Error, `prefix length ${len} must throw a plain Error, not crash`);
      thrown++;
    }
  }
  // The full file (and possibly a couple of other prefixes that happen to
  // land on a valid end-of-track boundary) import; every other prefix must
  // throw cleanly. The important property is: no prefix escapes both counts
  // (i.e. no uncaught non-Error crash, no hang — the loop completing at all
  // is the proof of that).
  assert.equal(thrown + imported, full.length + 1);
  assert.ok(imported >= 1, 'the full valid file itself must import');
});
