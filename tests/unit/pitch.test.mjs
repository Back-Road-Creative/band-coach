// src/core/pitch.js: the one Hz <-> MIDI conversion, plus the player's A4
// tuning-reference preference (415..466 Hz, default 440).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freqToMidi, midiToFreq, sanitizeA4, A4_MIN, A4_MAX, A4_DEFAULT, setReferencePitch, referencePitch } from '../../src/core/pitch.js';

test('440 is the default reference', () => {
  assert.equal(freqToMidi(440), 69);
  assert.equal(midiToFreq(69), 440);
  assert.equal(A4_DEFAULT, 440);
});

test('a 442 Hz tone is a little sharp against 440 and exactly A against 442', () => {
  assert.ok(Math.abs(freqToMidi(442, 440) - 69.0785) < 0.0001);
  assert.equal(freqToMidi(442, 442), 69);
  assert.equal(midiToFreq(69, 442), 442);
});

test('midiToFreq and freqToMidi round-trip for any reference', () => {
  for (const a4 of [415, 440, 442, 466]) for (let m = 28; m <= 100; m++) {
    assert.ok(Math.abs(freqToMidi(midiToFreq(m, a4), a4) - m) < 1e-9, `${a4} ${m}`);
  }
});

test('sanitizeA4 keeps whole Hz in range, rounds fractions, and falls back to 440 otherwise', () => {
  assert.equal(A4_MIN, 415); assert.equal(A4_MAX, 466);
  assert.equal(sanitizeA4(415), 415); assert.equal(sanitizeA4(466), 466); assert.equal(sanitizeA4(442), 442);
  assert.equal(sanitizeA4(442.5), 443);
  for (const bad of [414, 467, 0, -440, NaN, Infinity, '442', null, undefined, {}, [], true]) assert.equal(sanitizeA4(bad), 440, String(bad));
});

test('the shared reference follows setReferencePitch and always stays sane', () => {
  assert.equal(referencePitch(), 440);
  setReferencePitch(442); assert.equal(referencePitch(), 442);
  setReferencePitch('junk'); assert.equal(referencePitch(), 440);
  setReferencePitch(442); setReferencePitch(undefined); assert.equal(referencePitch(), 440);
});
