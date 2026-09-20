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
