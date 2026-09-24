// practiceGate (src/ui/songs/review.js, moved here from the now-retired
// src/ui/learn.js in P3-6): the pure decision behind the Add a song review
// screen's -- can "Practise this" be clicked yet, or does the song still
// carry unresolved check items from transcription (report.needsCheck) that
// "Fix it up" needs to clear first? Sending a song straight to practice
// with doubtful notes uncorrected is exactly what this gate exists to
// stop. No DOM in it, tested the same way chooseSaveTarget
// (src/ui/editor.js) is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceGate } from '../../src/ui/songs/review.js';

test('practiceGate: no warnings allows practice', () => {
  assert.deepEqual(practiceGate([]), { allowed: true, reason: null });
});

test('practiceGate: missing warnings list also allows practice', () => {
  assert.deepEqual(practiceGate(undefined), { allowed: true, reason: null });
});

test('practiceGate: pending warnings block practice, with a plain-language reason naming the count', () => {
  const gate = practiceGate(['Bar 2 beat 3 note unclear', 'Bar 4 beat 1 note unclear']);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /2/);
  assert.match(gate.reason, /fix/i);
});

test('practiceGate: a single pending warning still names the count', () => {
  const gate = practiceGate(['Bar 2 beat 3 note unclear']);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /1/);
});
