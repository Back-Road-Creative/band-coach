import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORDER_NOTES, WHISTLE_NOTES, fingeringFor } from '../../src/instruments/how/recorder-whistle.js';

test('recorder: every hole pattern has the same hole count (7)', () => {
  RECORDER_NOTES.forEach(n => assert.equal(n.holes.length, 7, n.name + ' holes: ' + n.holes));
});

test('recorder: notes are monotonically increasing in pitch', () => {
  for (let i = 1; i < RECORDER_NOTES.length; i++) {
    assert.ok(RECORDER_NOTES[i].midi > RECORDER_NOTES[i - 1].midi, RECORDER_NOTES[i].name);
  }
});

test('recorder: every note in the table lookups by its own midi', () => {
  RECORDER_NOTES.forEach(n => assert.equal(fingeringFor(n.midi, 'recorder').name, n.name));
});

test('recorder: a pitch outside the table returns null, not a guess', () => {
  assert.equal(fingeringFor(40, 'recorder'), null);
});

test('whistle: every hole pattern has the same hole count (6)', () => {
  WHISTLE_NOTES.forEach(n => assert.equal(n.holes.length, 6, n.name + ' holes: ' + n.holes));
});

test('whistle: notes are monotonically increasing in pitch and span exactly two octaves', () => {
  for (let i = 1; i < WHISTLE_NOTES.length; i++) {
    assert.ok(WHISTLE_NOTES[i].midi > WHISTLE_NOTES[i - 1].midi, WHISTLE_NOTES[i].name);
  }
  const low = WHISTLE_NOTES[0].midi;
  const high = WHISTLE_NOTES[WHISTLE_NOTES.length - 1].midi;
  assert.equal(high - low, 24);
});

test('whistle: the second octave reuses first-octave hole patterns, flagged overblow', () => {
  const octave1 = WHISTLE_NOTES.filter(n => !n.overblow);
  const octave2 = WHISTLE_NOTES.filter(n => n.overblow);
  assert.equal(octave1.length, 7);
  assert.equal(octave2.length, 8);
  octave1.forEach((n, i) => assert.equal(n.holes, octave2[i].holes));
});

test('whistle: every note in the table looks up by its own midi', () => {
  WHISTLE_NOTES.forEach(n => assert.equal(fingeringFor(n.midi, 'whistle').holes, n.holes));
});

test('fingeringFor rejects an unknown instrument', () => {
  assert.throws(() => fingeringFor(60, 'kazoo'));
});
