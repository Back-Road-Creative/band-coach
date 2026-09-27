import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_SOURCES, makeInputEvent, validateInputEvent, evidenceFor } from '../../src/core/input-event.js';

// ---------- makeInputEvent / validateInputEvent ----------

test('makeInputEvent: fills the envelope defaults around the caller\'s fields', () => {
  const ev = makeInputEvent({ source: 'midi', channel: 0, pitch: 60, onsetSec: 1.5, confidence: 1 });
  assert.equal(ev.source, 'midi');
  assert.equal(ev.pitch, 60);
  assert.equal(ev.clock, 'audio');
  assert.equal(ev.releaseSec, null);
  assert.equal(ev.demo, false);
});

test('validateInputEvent: a well-formed midi event is ok', () => {
  const ev = makeInputEvent({ source: 'midi', channel: 0, pitch: 60, onsetSec: 1.5, confidence: 1 });
  assert.deepEqual(validateInputEvent(ev), { ok: true, errors: [] });
});

test('validateInputEvent: rejects a source outside the known list', () => {
  const ev = makeInputEvent({ source: 'bogus', onsetSec: 1, confidence: 1 });
  const r = validateInputEvent(ev);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('source')));
});

test('validateInputEvent: clock must be the audio clock, never a wall clock', () => {
  const ev = makeInputEvent({ source: 'tap', onsetSec: 1, confidence: 1, clock: 'perf' });
  const r = validateInputEvent(ev);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('clock')));
});

test('validateInputEvent: confidence outside 0..1 is rejected, but null (unknown) is fine', () => {
  const bad = makeInputEvent({ source: 'mic', onsetSec: 1, confidence: 1.5 });
  assert.equal(validateInputEvent(bad).ok, false);
  const unknown = makeInputEvent({ source: 'mic', onsetSec: 1, confidence: null });
  assert.equal(validateInputEvent(unknown).ok, true);
});

test('validateInputEvent: rejects a non-finite onsetSec', () => {
  const ev = makeInputEvent({ source: 'tap', onsetSec: NaN, confidence: 1 });
  assert.equal(validateInputEvent(ev).ok, false);
});

test('INPUT_SOURCES lists exactly the four capture paths', () => {
  assert.deepEqual(INPUT_SOURCES, ['midi', 'mic', 'key', 'tap']);
});

// ---------- evidenceFor ----------

function midiNote(onsetSec, overrides) {
  return makeInputEvent(Object.assign({ source: 'midi', channel: 0, pitch: 60, onsetSec, releaseSec: onsetSec + 0.2, confidence: 1 }, overrides));
}

test('evidenceFor: silence (no events) proves nothing', () => {
  const r = evidenceFor([], { assess: 'midi', dims: ['pitch'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, []);
  assert.deepEqual(r.unassessed, []);
});

test('evidenceFor: the app\'s own demonstration audio is never evidence', () => {
  const demo = midiNote(5, { demo: true });
  const r = evidenceFor([demo], { assess: 'midi', dims: ['pitch'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, []);
});

test('evidenceFor: unknown confidence (null) is excluded, not assumed innocent', () => {
  const unsure = midiNote(5, { confidence: null });
  const r = evidenceFor([unsure], { assess: 'midi', dims: ['pitch'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, []);
});

test('evidenceFor: assess "none" proves nothing at all, whatever the events say', () => {
  const note = midiNote(5);
  const r = evidenceFor([note], { assess: 'none', dims: ['pitch', 'onset'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, []);
  assert.deepEqual(r.unassessed, ['pitch', 'onset']);
});

test('evidenceFor: mic-single-note cannot prove chord or drum dims', () => {
  const note = midiNote(5, { source: 'mic' });
  const r = evidenceFor([note], { assess: 'mic-single-note', dims: ['pitch', 'chord', 'drum'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, [note]);
  assert.deepEqual(r.unassessed, ['chord', 'drum']);
});

test('evidenceFor: tap proves only onset/rhythm, never pitch', () => {
  const tap = makeInputEvent({ source: 'tap', onsetSec: 5, confidence: 1 });
  const r = evidenceFor([tap], { assess: 'tap', dims: ['onset', 'pitch'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, [tap]);
  assert.deepEqual(r.unassessed, ['pitch']);
});

test('evidenceFor: a held note (no releaseSec) older than the stale window is excluded', () => {
  const held = midiNote(1, { releaseSec: null }); // held since t=1, still not released
  const r = evidenceFor([held], { assess: 'midi', dims: ['pitch'], nowSec: 10, staleSec: 2 }); // 10 - 2 = 8 > 1
  assert.deepEqual(r.eligible, []);
});

test('evidenceFor: a held note still inside the stale window is eligible', () => {
  const held = midiNote(9, { releaseSec: null });
  const r = evidenceFor([held], { assess: 'midi', dims: ['pitch'], nowSec: 10, staleSec: 2 }); // 10 - 2 = 8 < 9
  assert.deepEqual(r.eligible, [held]);
});

test('evidenceFor: a positive midi case proves pitch, chord, onset, hold and drum', () => {
  const note = midiNote(5);
  const r = evidenceFor([note], { assess: 'midi', dims: ['pitch', 'chord', 'onset', 'hold', 'drum'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.eligible, [note]);
  assert.deepEqual(r.unassessed, []);
});

test('evidenceFor: midi never proves tune, since a MIDI note number is always in tune', () => {
  const note = midiNote(5);
  const r = evidenceFor([note], { assess: 'midi', dims: ['pitch', 'tune'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.unassessed, ['tune']);
});

test('evidenceFor: dim names match the grading dims in src/ui/songs/assessed.js', () => {
  const note = midiNote(5);
  const r = evidenceFor([note], { assess: 'midi', dims: ['drum-identity'], nowSec: 10, staleSec: 2 });
  assert.deepEqual(r.unassessed, ['drum-identity'], 'an unknown dim name is never provable');
});
