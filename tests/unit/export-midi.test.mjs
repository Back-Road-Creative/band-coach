import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMidi } from '../../src/song/export-midi.js';
import { importMidi } from '../../src/song/import-midi.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { TICKS_PER_QUARTER } from '../../src/song/model.js';

function notesOf(part) {
  return part.notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur }));
}

// --- round trip: every starter song survives export -> import with the same
// notes per part (midi, start, dur) and the same bpm. ---

test('exportMidi -> importMidi round trip preserves notes and bpm for every starter song', () => {
  for (const song of starterSongs) {
    const bytes = exportMidi(song);
    const { song: back } = importMidi(bytes);
    // SMF tempo is stored as integer microseconds-per-quarter-note, so a
    // bpm that doesn't divide 60,000,000 exactly loses a little precision
    // going through the format; a small tolerance accounts for that
    // quantization without hiding a real mismatch.
    assert.ok(Math.abs(back.bpm - song.bpm) < 0.01, `bpm mismatch for "${song.id}": ${back.bpm} vs ${song.bpm}`);
    assert.equal(back.parts.length, song.parts.length, `part count mismatch for "${song.id}"`);
    for (let i = 0; i < song.parts.length; i++) {
      assert.deepEqual(notesOf(back.parts[i]), notesOf(song.parts[i]), `notes mismatch for "${song.id}" part ${i}`);
    }
  }
});

test('exportMidi output is deterministic (same song -> byte-identical output)', () => {
  const song = starterSongs[0];
  const a = exportMidi(song);
  const b = exportMidi(song);
  assert.deepEqual(Array.from(a), Array.from(b));
});

// --- byte-level: header + track chunk structure ---

function readAscii(bytes, offset, len) {
  return String.fromCharCode(...bytes.slice(offset, offset + len));
}

function u16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

test('exportMidi writes a well-formed SMF type 1 header', () => {
  const song = starterSongs[0]; // single melody part
  const bytes = exportMidi(song);
  assert.equal(readAscii(bytes, 0, 4), 'MThd');
  assert.equal(u32(bytes, 4), 6); // header length
  const format = u16(bytes, 8);
  const ntrks = u16(bytes, 10);
  const division = u16(bytes, 12);
  assert.equal(format, 1);
  assert.equal(ntrks, 1 + song.parts.length); // conductor track + one per part
  assert.equal(division, TICKS_PER_QUARTER);
});

test('exportMidi writes one MTrk chunk per declared track, each ending in an end-of-track meta event', () => {
  const song = starterSongs[0];
  const bytes = exportMidi(song);
  let pos = 14; // past MThd chunk (8 header bytes + 6 data bytes)
  let trackCount = 0;
  while (pos < bytes.length) {
    const type = readAscii(bytes, pos, 4);
    assert.equal(type, 'MTrk');
    const len = u32(bytes, pos + 4);
    const trackStart = pos + 8;
    const trackEnd = trackStart + len;
    assert.ok(trackEnd <= bytes.length, 'track chunk runs past end of file');
    // end-of-track meta event (FF 2F 00) is the last three bytes of the chunk
    assert.equal(bytes[trackEnd - 3], 0xff);
    assert.equal(bytes[trackEnd - 2], 0x2f);
    assert.equal(bytes[trackEnd - 1], 0x00);
    pos = trackEnd;
    trackCount++;
  }
  assert.equal(trackCount, 1 + song.parts.length);
});

test('exportMidi track 0 carries a tempo meta event derived from song.bpm', () => {
  const song = starterSongs[0];
  const bytes = exportMidi(song);
  const headerChunkLen = u32(bytes, 4);
  const track0Pos = 8 + headerChunkLen; // past MThd chunk (8-byte prefix + data)
  const len = u32(bytes, track0Pos + 4);
  const trackStart = track0Pos + 8;
  const trackBytes = Array.from(bytes.slice(trackStart, trackStart + len));
  // delta 0x00, meta 0xFF, tempo type 0x51, length 0x03
  assert.deepEqual(trackBytes.slice(0, 4), [0x00, 0xff, 0x51, 0x03]);
  const micros = (trackBytes[4] << 16) | (trackBytes[5] << 8) | trackBytes[6];
  const bpm = Math.round((60000000 / micros) * 100) / 100;
  assert.equal(bpm, song.bpm);
});

// --- percussion parts write channel 10 (U4) ---

function drumSong() {
  return {
    schema: 'song/1', id: 'drums', title: 'Drums', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [
      { start: 0, dur: 240, midi: 38, piece: 'snare' },
      { start: 240, dur: 240, midi: 35, piece: 'kick' },
    ] }],
    chords: [],
  };
}

test('exportMidi writes a percussion part on channel 10 (status 0x99/0x89)', () => {
  const song = drumSong();
  const bytes = exportMidi(song);
  const headerChunkLen = u32(bytes, 4);
  const track0Pos = 8 + headerChunkLen;
  const track0Len = u32(bytes, track0Pos + 4);
  const track1Pos = track0Pos + 8 + track0Len;
  const track1Len = u32(bytes, track1Pos + 4);
  const trackBytes = Array.from(bytes.slice(track1Pos + 8, track1Pos + 8 + track1Len));

  const statuses = trackBytes.filter((b) => b === 0x99 || b === 0x89 || b === 0x90 || b === 0x80);
  assert.ok(statuses.includes(0x99), 'expected a channel-10 note-on (0x99)');
  assert.ok(statuses.includes(0x89), 'expected a channel-10 note-off (0x89)');
  assert.ok(!statuses.includes(0x90), 'must not write channel-1 note-on for a percussion part');
  assert.ok(!statuses.includes(0x80), 'must not write channel-1 note-off for a percussion part');
});

test('exportMidi -> importMidi round trip keeps role, piece and ticks for a percussion part', () => {
  const song = drumSong();
  const bytes = exportMidi(song);
  const { song: back } = importMidi(bytes);

  assert.equal(back.parts.length, 1);
  assert.equal(back.parts[0].role, 'percussion');
  assert.deepEqual(
    back.parts[0].notes.map((n) => ({ start: n.start, dur: n.dur, midi: n.midi, piece: n.piece })),
    song.parts[0].notes.map((n) => ({ start: n.start, dur: n.dur, midi: n.midi, piece: n.piece }))
  );
});
