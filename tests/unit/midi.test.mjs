import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMidiParser, describeInputs } from '../../src/core/midi.js';

test('note-on with velocity > 0 is an "on" event', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0x90, 60, 100])), [{ type: 'on', note: 60, velocity: 100, channel: 0 }]);
});

test('note-off (0x80) is an "off" event', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0x80, 60, 64])), [{ type: 'off', note: 60, velocity: 64, channel: 0 }]);
});

test('note-on with velocity 0 is treated as note-off', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0x90, 60, 0])), [{ type: 'off', note: 60, velocity: 0, channel: 0 }]);
});

test('all 16 channels are decoded from the low nibble of the status byte', () => {
  const p = createMidiParser();
  for (let ch = 0; ch < 16; ch++) {
    const events = p.feed(new Uint8Array([0x90 | ch, 60 + ch, 100]));
    assert.deepEqual(events, [{ type: 'on', note: 60 + ch, velocity: 100, channel: ch }]);
  }
});

test('running status: a 2-byte data-only message reuses the previous status byte', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0x90, 60, 100])), [{ type: 'on', note: 60, velocity: 100, channel: 0 }]);
  // No status byte this time -- a real keyboard playing a fast run drops it.
  assert.deepEqual(p.feed(new Uint8Array([62, 100])), [{ type: 'on', note: 62, velocity: 100, channel: 0 }]);
  assert.deepEqual(p.feed(new Uint8Array([62, 0])), [{ type: 'off', note: 62, velocity: 0, channel: 0 }]);
});

test('running status survives across separate feed() calls, not just within one buffer', () => {
  const p = createMidiParser();
  p.feed(new Uint8Array([0x80, 60, 0]));
  assert.deepEqual(p.feed(new Uint8Array([64, 0])), [{ type: 'off', note: 64, velocity: 0, channel: 0 }]);
});

test('realtime/system bytes (>= 0xF0) are ignored without breaking running status', () => {
  const p = createMidiParser();
  p.feed(new Uint8Array([0x90, 60, 100]));
  // 0xF8 (timing clock) spliced into the middle of what would otherwise be a running-status note-on.
  assert.deepEqual(p.feed(new Uint8Array([0xf8, 62, 100])), [{ type: 'on', note: 62, velocity: 100, channel: 0 }]);
  assert.deepEqual(p.feed(new Uint8Array([0xff])), []);
});

test('a buffer can carry more than one message, running status included', () => {
  const p = createMidiParser();
  const events = p.feed(new Uint8Array([0x90, 60, 100, 62, 100, 60, 0]));
  assert.deepEqual(events, [
    { type: 'on', note: 60, velocity: 100, channel: 0 },
    { type: 'on', note: 62, velocity: 100, channel: 0 },
    { type: 'off', note: 60, velocity: 0, channel: 0 },
  ]);
});

test('describeInputs: counts only connected ports and names them', () => {
  const inputs = [
    { id: 'a', name: 'Keystation', state: 'connected' },
    { id: 'b', name: 'Old Keyboard', state: 'disconnected' },
  ];
  const d = describeInputs(inputs);
  assert.equal(d.total, 2);
  assert.equal(d.connected.length, 1);
  assert.deepEqual(d.names, ['Keystation']);
});

test('describeInputs: accepts a Map-like forEach (the real MIDIAccess.inputs shape)', () => {
  const map = new Map([['a', { id: 'a', name: 'Keystation', state: 'connected' }]]);
  const d = describeInputs(map);
  assert.equal(d.total, 1);
  assert.deepEqual(d.names, ['Keystation']);
});

test('describeInputs: an unnamed port falls back to a generic label', () => {
  const d = describeInputs([{ id: 'a', state: 'connected' }]);
  assert.deepEqual(d.names, ['MIDI device']);
});

// System Common messages carry data bytes of their own (MTC quarter frame 1,
// Song Position Pointer 2, Song Select 1) and cancel running status; only
// realtime bytes (0xF8-0xFF) are single-byte and leave it alone.
test('a Song Position Pointer before a note-on does not swallow the note', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0xf2, 0x10, 0x20, 0x90, 0x40, 0x64])), [{ type: 'on', note: 0x40, velocity: 0x64, channel: 0 }]);
});

test('System Common data bytes are never read as a phantom running-status note', () => {
  const p = createMidiParser();
  p.feed(new Uint8Array([0x90, 60, 100]));
  assert.deepEqual(p.feed(new Uint8Array([0xf1, 0x21, 0xf3, 0x05, 0x90, 0x40, 0x64])), [{ type: 'on', note: 0x40, velocity: 0x64, channel: 0 }]);
  // ...and running status is cancelled, so bare data bytes after them are dropped, not guessed at.
  assert.deepEqual(p.feed(new Uint8Array([0xf2, 0x10, 0x20])), []);
  assert.deepEqual(p.feed(new Uint8Array([0x41, 0x64])), []);
});

test('a SysEx block is skipped whole, however many data bytes it holds', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7, 0x90, 60, 100])), [{ type: 'on', note: 60, velocity: 100, channel: 0 }]);
});

test('program change and channel pressure carry ONE data byte, so the next note survives', () => {
  const p = createMidiParser();
  assert.deepEqual(p.feed(new Uint8Array([0xc0, 5, 0x90, 60, 100])), [{ type: 'on', note: 60, velocity: 100, channel: 0 }]);
  assert.deepEqual(p.feed(new Uint8Array([0xd1, 40, 0x91, 62, 90])), [{ type: 'on', note: 62, velocity: 90, channel: 1 }]);
});

test('a note message missing its velocity byte is truncated, not a phantom note-off', () => {
  const p = createMidiParser();
  p.feed(new Uint8Array([0x90, 60, 100]));
  assert.deepEqual(p.feed(new Uint8Array([0x44])), []);
  assert.deepEqual(p.feed(new Uint8Array([0x90, 0x44])), []);
});
