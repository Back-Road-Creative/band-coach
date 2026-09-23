import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOutputs, scheduleSong, playOnOutput, stopAll } from '../../src/core/midi.js';
import { TICKS_PER_QUARTER } from '../../src/song/model.js';

function fakeOutput() {
  return { sent: [], send(bytes, atMs) { this.sent.push({ bytes: Array.from(bytes), atMs }); } };
}

// Built by hand, not via normalizeSong: normalizeSong strips any field
// (like note.velocity) that isn't part of the validated Song schema, and
// scheduleSong needs to read velocity straight off the note.
function songWithNotes(notes, extra) {
  return Object.assign({
    schema: 'song/1', id: 's1', title: 'Song', composer: null, licence: null, source: null,
    key: null, bpm: 120, metre: { num: 4, den: 4 }, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'p1', name: 'Part 1', notes }],
    chords: []
  }, extra);
}

// ---- describeOutputs ----------------------------------------------------

test('describeOutputs: counts only connected ports and names them (mirrors describeInputs)', () => {
  const outputs = [
    { id: 'a', name: 'Keystation', state: 'connected' },
    { id: 'b', name: 'Old Keyboard', state: 'disconnected' },
  ];
  const d = describeOutputs(outputs);
  assert.equal(d.total, 2);
  assert.equal(d.connected.length, 1);
  assert.deepEqual(d.names, ['Keystation']);
});

test('describeOutputs: accepts a Map-like forEach (the real MIDIAccess.outputs shape)', () => {
  const map = new Map([['a', { id: 'a', name: 'Keystation', state: 'connected' }]]);
  const d = describeOutputs(map);
  assert.equal(d.total, 1);
  assert.deepEqual(d.names, ['Keystation']);
});

test('describeOutputs: an unnamed port falls back to a generic label', () => {
  const d = describeOutputs([{ id: 'a', state: 'connected' }]);
  assert.deepEqual(d.names, ['MIDI device']);
});

test('describeOutputs: missing/empty map yields zero total, no names', () => {
  assert.deepEqual(describeOutputs(undefined), { total: 0, connected: [], names: [] });
  assert.deepEqual(describeOutputs([]), { total: 0, connected: [], names: [] });
});

// ---- scheduleSong --------------------------------------------------------

test('scheduleSong: two sequential notes produce on/off at times derived from ticks and bpm', () => {
  const song = songWithNotes([
    { start: 0, dur: TICKS_PER_QUARTER, midi: 60 },
    { start: TICKS_PER_QUARTER, dur: TICKS_PER_QUARTER, midi: 62 },
  ]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0 });
  // At 120bpm a quarter note is 500ms.
  assert.deepEqual(messages, [
    { atMs: 0, bytes: [0x90, 60, 80] },
    { atMs: 500, bytes: [0x80, 60, 0] },
    { atMs: 500, bytes: [0x90, 62, 80] },
    { atMs: 1000, bytes: [0x80, 62, 0] },
  ]);
});

test('scheduleSong: startMs offsets every event', () => {
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 60 }]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 250, channel: 0 });
  assert.deepEqual(messages, [
    { atMs: 250, bytes: [0x90, 60, 80] },
    { atMs: 750, bytes: [0x80, 60, 0] },
  ]);
});

test('scheduleSong: velocity defaults to 80 when the note has none, and is used when present', () => {
  const song = songWithNotes([
    { start: 0, dur: TICKS_PER_QUARTER, midi: 60 },
    { start: TICKS_PER_QUARTER, dur: TICKS_PER_QUARTER, midi: 62, velocity: 40 },
  ]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0 });
  const onEvents = messages.filter(m => (m.bytes[0] & 0xf0) === 0x90);
  assert.deepEqual(onEvents.map(m => m.bytes[2]), [80, 40]);
});

test('scheduleSong: velocity is clamped to 0-127', () => {
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 60, velocity: 500 }]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0 });
  assert.equal(messages[0].bytes[2], 127);
});

test('scheduleSong: channel is masked into the status byte low nibble', () => {
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 60 }]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 17 });
  // 17 & 0x0f === 1
  assert.equal(messages[0].bytes[0], 0x90 | 1);
  assert.equal(messages[1].bytes[0], 0x80 | 1);
});

test('scheduleSong: transpose shifts pitch and clamps to 0-127', () => {
  const song = songWithNotes([
    { start: 0, dur: TICKS_PER_QUARTER, midi: 60 },
    { start: TICKS_PER_QUARTER, dur: TICKS_PER_QUARTER, midi: 125 },
  ]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0, transpose: 5 });
  const onEvents = messages.filter(m => (m.bytes[0] & 0xf0) === 0x90);
  assert.deepEqual(onEvents.map(m => m.bytes[1]), [65, 127]);
});

test('scheduleSong: an overlapping same-pitch note cuts the earlier note off before the next on', () => {
  // Note A: pitch 60, ticks 0..960 (two quarters). Note B: pitch 60, starts at
  // tick 480 (overlaps A) and runs to 1440. The A-off must land at B's onMs,
  // strictly before B's on, not at A's own original end.
  const song = songWithNotes([
    { start: 0, dur: TICKS_PER_QUARTER * 2, midi: 60 },
    { start: TICKS_PER_QUARTER, dur: TICKS_PER_QUARTER * 2, midi: 60 },
  ]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0 });
  assert.deepEqual(messages, [
    { atMs: 0, bytes: [0x90, 60, 80] },
    { atMs: 500, bytes: [0x80, 60, 0] }, // A's off, pulled in from 1000ms to B's onset
    { atMs: 500, bytes: [0x90, 60, 80] }, // B's on
    { atMs: 1500, bytes: [0x80, 60, 0] }, // B's off, its own natural end
  ]);
});

test('scheduleSong: rests (no midi pitch) are skipped', () => {
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 60 }]);
  // Splice in a rest-shaped entry after normalization runs its validation-free path.
  song.parts[0].notes.push({ start: TICKS_PER_QUARTER, dur: TICKS_PER_QUARTER, midi: null });
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 0 });
  assert.equal(messages.length, 2);
});

test('scheduleSong: throws a plain-English error for an out-of-range partIndex', () => {
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 60 }]);
  assert.throws(() => scheduleSong(song, { partIndex: 3, bpm: 120, startMs: 0, channel: 0 }), /part/i);
});

// ---- playOnOutput / stopAll ---------------------------------------------

test('playOnOutput: sends every message\'s bytes at its timestamp, in order', () => {
  const output = fakeOutput();
  const messages = [
    { atMs: 0, bytes: [0x90, 60, 80] },
    { atMs: 500, bytes: [0x80, 60, 0] },
  ];
  playOnOutput(output, messages);
  assert.deepEqual(output.sent, [
    { bytes: [0x90, 60, 80], atMs: 0 },
    { bytes: [0x80, 60, 0], atMs: 500 },
  ]);
});

test('stopAll: sends All Notes Off (CC 123) on the given channel plus a note-off for every possible note', () => {
  const output = fakeOutput();
  stopAll(output, 2);
  assert.deepEqual(output.sent[0].bytes, [0xb0 | 2, 123, 0]);
  assert.equal(output.sent.length, 1 + 128);
  for (let note = 0; note < 128; note++) {
    assert.deepEqual(output.sent[1 + note].bytes, [0x80 | 2, note, 0]);
  }
});

test('stopAll after a partial play still turns off notes that were started but never released', () => {
  const output = fakeOutput();
  const song = songWithNotes([{ start: 0, dur: TICKS_PER_QUARTER, midi: 67 }]);
  const messages = scheduleSong(song, { partIndex: 0, bpm: 120, startMs: 0, channel: 3 });
  // Only send the note-on half -- simulating playback interrupted mid-note.
  playOnOutput(output, messages.filter(m => (m.bytes[0] & 0xf0) === 0x90));
  stopAll(output, 3);
  const noteOffsForPitch67 = output.sent.filter(s => s.bytes[0] === (0x80 | 3) && s.bytes[1] === 67);
  assert.equal(noteOffsForPitch67.length, 1);
});

test('stopAll: channel is masked into the status byte low nibble', () => {
  const output = fakeOutput();
  stopAll(output, 19); // 19 & 0x0f === 3
  assert.equal(output.sent[0].bytes[0], 0xb0 | 3);
  assert.equal(output.sent[1].bytes[0], 0x80 | 3);
});
