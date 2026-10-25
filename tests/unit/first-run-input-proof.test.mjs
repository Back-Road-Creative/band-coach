// F4: the first-run input proof names the first clean note a new learner plays ("Heard A4"). heardNote() is the
// pure check behind it: the last few frames must all read as the same clear pitch over the gate, so one stray
// frame (a pick scrape, a breath) is never taken as proof the input works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heardNote } from '../../src/audio/input-diagnosis.js';

const clear = (midi, rms = 0.05) => ({ rms, clarity: 0.95, midi });

test('three clear frames of the same pitch name that note, rounded to the nearest semitone', () => {
  assert.equal(heardNote([clear(68.8), clear(69.1), clear(69.2)], { gate: 0.01 }), 69);
});

test('fewer frames than needed, or a run broken by another pitch, is not yet proof', () => {
  assert.equal(heardNote([clear(69), clear(69)], { gate: 0.01 }), null);
  assert.equal(heardNote([clear(69), clear(64), clear(69)], { gate: 0.01 }), null);
});

test('frames under the gate, unclear frames and frames with no pitch never count', () => {
  assert.equal(heardNote([clear(69, 0.001), clear(69, 0.001), clear(69, 0.001)], { gate: 0.01 }), null);
  assert.equal(heardNote([clear(69), { rms: 0.05, clarity: 0.5, midi: 69 }, clear(69)], { gate: 0.01 }), null);
  assert.equal(heardNote([clear(69), { rms: 0.05, clarity: 0.95 }, clear(69)], { gate: 0.01 }), null);
  assert.equal(heardNote(null), null);
});

test('only the newest frames decide: an old run followed by noise is not proof, a fresh run after noise is', () => {
  assert.equal(heardNote([clear(69), clear(69), clear(69), clear(64)], { gate: 0.01 }), null);
  assert.equal(heardNote([clear(64), clear(60), clear(57), clear(57), clear(57)], { gate: 0.01 }), 57);
  assert.equal(heardNote([clear(57), clear(57)], { gate: 0.01, need: 2 }), 57);
});
