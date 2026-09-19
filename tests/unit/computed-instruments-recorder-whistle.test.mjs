import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORDER_NOTES, WHISTLE_NOTES, fingeringFor } from '../../src/instruments/how/recorder-whistle.js';

test('recorder: every hole pattern has the same hole count (8)', () => {
  RECORDER_NOTES.forEach(n => assert.equal(n.holes.length, 8, n.name + ' holes: ' + n.holes));
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

test('whistle: the second octave reuses first-octave hole patterns (D vented), flagged overblow', () => {
  const octave1 = WHISTLE_NOTES.filter(n => !n.overblow);
  const octave2 = WHISTLE_NOTES.filter(n => n.overblow);
  assert.equal(octave1.length, 7);
  assert.equal(octave2.length, 8);
  // Every second-octave note reuses the first-octave shape except D, which is vented.
  octave1.forEach((n, i) => assert.equal(octave2[i].holes, i === 0 ? 'oxxxxx' : n.holes));
});

test('whistle: every note in the table looks up by its own midi', () => {
  WHISTLE_NOTES.forEach(n => assert.equal(fingeringFor(n.midi, 'whistle').holes, n.holes));
});

test('fingeringFor rejects an unknown instrument', () => {
  assert.throws(() => fingeringFor(60, 'kazoo'));
});

// A soprano recorder has a thumb hole plus SEVEN finger holes. These are the
// standard baroque (English) fingerings, written thumb first then holes 1-7.
test('recorder: baroque fingerings, thumb + seven finger holes', () => {
  const want = { C5: 'xxxxxxxx', D5: 'xxxxxxxo', E5: 'xxxxxxoo', F5: 'xxxxxoxx', G5: 'xxxxoooo',
    A5: 'xxxooooo', B5: 'xxoooooo', C6: 'xoxooooo', D6: 'ooxooooo' };
  for (const [name, holes] of Object.entries(want)) {
    assert.equal(RECORDER_NOTES.find(n => n.name === name).holes, holes, name);
  }
});

test('whistle: a high D whistle sounds D5 at the bottom, and second-octave D vents the top hole', () => {
  assert.equal(WHISTLE_NOTES[0].midi, 74);
  assert.equal(WHISTLE_NOTES[0].name, 'D5');
  assert.equal(WHISTLE_NOTES[7].name, 'D6');
  assert.equal(WHISTLE_NOTES[7].holes, 'oxxxxx');
});
