import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoteState } from '../../src/core/note-state.js';

test('noteOn then isHeld/heldPitches reflect the held note', () => {
  const s = createNoteState();
  assert.equal(s.isHeld(60), false);
  s.noteOn('p1', 0, 60);
  assert.equal(s.isHeld(60), true);
  assert.deepEqual(s.heldPitches(), [60]);
});

test('noteOff releases the pitch', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOff('p1', 0, 60);
  assert.equal(s.isHeld(60), false);
  assert.deepEqual(s.heldPitches(), []);
});

test('the same pitch held on two different ports is independent: releasing one leaves the other held', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p2', 0, 60);
  s.noteOff('p1', 0, 60);
  // Still held -- p2's note-on for the same pitch must not be cancelled by
  // p1's note-off (the bug: a pitch-only Set treated them as one note).
  assert.equal(s.isHeld(60), true);
  s.noteOff('p2', 0, 60);
  assert.equal(s.isHeld(60), false);
});

test('ports identified by distinct objects (the real caller\'s shape -- a live MIDIInput, not a string id) stay independent', () => {
  // Regression guard: an earlier version folded port into a string key with
  // `port + ...`, and two different objects both stringify to
  // "[object Object]" -- silently reuniting every port into one.
  const s = createNoteState();
  const portA = { name: 'A' }, portB = { name: 'B' };
  s.noteOn(portA, 0, 60);
  s.noteOn(portB, 0, 60);
  s.noteOff(portA, 0, 60);
  assert.equal(s.isHeld(60), true);
  assert.deepEqual(s.releaseAll(portB), [60]);
  assert.equal(s.isHeld(60), false);
});

test('the same pitch held on two different channels of the same port is independent', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p1', 1, 60);
  s.noteOff('p1', 0, 60);
  assert.equal(s.isHeld(60), true);
  s.noteOff('p1', 1, 60);
  assert.equal(s.isHeld(60), false);
});

test('releaseAll() with no argument releases every held note on every port and returns the released pitches', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p2', 0, 64);
  s.noteOn('p1', 0, 67);
  const released = s.releaseAll().sort((a, b) => a - b);
  assert.deepEqual(released, [60, 64, 67]);
  assert.deepEqual(s.heldPitches(), []);
});

test('releaseAll(port) releases only that port\'s notes, leaving other ports held', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p2', 0, 64);
  const released = s.releaseAll('p1');
  assert.deepEqual(released, [60]);
  assert.equal(s.isHeld(60), false);
  assert.equal(s.isHeld(64), true);
});

test('releaseAll(port) still held by another port after releasing one keeps the pitch reported as held', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p2', 0, 60);
  const released = s.releaseAll('p1');
  assert.deepEqual(released, [60]); // p1's own note-on was released
  assert.equal(s.isHeld(60), true); // but p2 still holds the same pitch
});

test('clear() drops every held note with no return value expectation', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.clear();
  assert.deepEqual(s.heldPitches(), []);
});

test('a duplicate noteOn for an already-held port+channel+pitch does not create a phantom second hold', () => {
  const s = createNoteState();
  s.noteOn('p1', 0, 60);
  s.noteOn('p1', 0, 60);
  s.noteOff('p1', 0, 60);
  assert.equal(s.isHeld(60), false);
});

test('noteOff for a pitch never held is a no-op, not an error', () => {
  const s = createNoteState();
  assert.doesNotThrow(() => s.noteOff('p1', 0, 60));
  assert.equal(s.isHeld(60), false);
});
