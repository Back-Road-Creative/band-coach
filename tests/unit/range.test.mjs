// The pitch detector (src/audio/yin.js, src/audio/pitch-worklet.js) used to
// search a generic 36-1600 Hz band everywhere, regardless of which
// instrument the learner picked. rangeForInstrument (src/audio/range.js)
// turns an instrument record's MIDI range into a Hz search window shaped to
// that instrument instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeForInstrument, FALLBACK_RANGE, midiToHz, frameSizeForInstrument, MIN_FRAME_SIZE } from '../../src/audio/range.js';
import doubleBass from '../../src/instruments/double-bass.js';
import flute from '../../src/instruments/flute.js';
import bass from '../../src/instruments/bass.js';
import bass5String from '../../src/instruments/bass-5-string.js';
import gtr from '../../src/instruments/gtr.js';
import { createRecorder } from '../../src/ui/editor/record.js';

test('midiToHz matches the standard A440 reference', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(60) - 261.63) < 0.01); // middle C
});

test('rangeForInstrument narrows to a low instrument (double bass, MIDI 28-48)', () => {
  const r = rangeForInstrument(doubleBass);
  // double bass's beginner range (E1..C3) sits near the bottom of the
  // generic 36-1600 Hz band already, so fmin barely moves -- but fmax must
  // come down drastically, from 1600 Hz to just above the top written note.
  assert.ok(r.fmax < FALLBACK_RANGE.fmax, 'fmax should fall well below the generic ceiling');
  assert.ok(r.fmax < 200, 'fmax should sit just above the double bass\'s beginner range, not the generic ceiling');
  assert.ok(r.fmin < midiToHz(doubleBass.range.low), 'fmin must still sit below the lowest written note (margin)');
  assert.ok(r.fmax > midiToHz(doubleBass.range.high), 'fmax must still sit above the highest written note (margin)');
});

test('rangeForInstrument narrows to a high instrument (flute, MIDI 60-72)', () => {
  const r = rangeForInstrument(flute);
  assert.ok(r.fmin > FALLBACK_RANGE.fmin, 'fmin should rise above the generic floor');
  assert.ok(r.fmax < FALLBACK_RANGE.fmax, 'fmax should fall well below the generic ceiling');
  assert.ok(r.fmin < midiToHz(flute.range.low));
  assert.ok(r.fmax > midiToHz(flute.range.high));
});

test('a low instrument and a high instrument get disjoint search windows', () => {
  const lo = rangeForInstrument(doubleBass);
  const hi = rangeForInstrument(flute);
  assert.ok(lo.fmax < hi.fmin, 'double bass\'s window must sit entirely below flute\'s');
});

test('rangeForInstrument falls back to the generic band with no record', () => {
  assert.deepEqual(rangeForInstrument(null), { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax });
  assert.deepEqual(rangeForInstrument(undefined), { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax });
  assert.deepEqual(rangeForInstrument({}), { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax });
  assert.deepEqual(rangeForInstrument({ range: { low: 'x', high: 5 } }), { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax });
});

// ---- wiring: prove a caller (the "Record a tune" panel's main-thread
// sampler) actually receives the narrowed range for a chosen instrument,
// not just that the pure function computes one in isolation.
function fakeApi(instrumentRec) {
  return {
    instrument: () => instrumentRec,
    openMic: async () => {},
    analysers: () => ({ time: null }),
    audio: () => null,
    gates: () => ({ pitch: 0.008 }),
    now: () => 0,
  };
}

test('createRecorder narrows to the picked instrument range on start', async (t) => {
  const rec = createRecorder(fakeApi(doubleBass));
  t.after(() => rec.stop());
  await rec.start();
  assert.deepEqual(rec.range, rangeForInstrument(doubleBass));
  assert.notEqual(rec.range.fmax, FALLBACK_RANGE.fmax);
});

test('createRecorder falls back to the generic range with no instrument picked', async (t) => {
  const rec = createRecorder(fakeApi(undefined));
  t.after(() => rec.stop());
  await rec.start();
  assert.deepEqual(rec.range, { fmin: FALLBACK_RANGE.fmin, fmax: FALLBACK_RANGE.fmax });
});

test('an explicit fmin/fmax override still wins over the instrument-derived range', async (t) => {
  const rec = createRecorder(fakeApi(doubleBass), { fmin: 1, fmax: 2 });
  t.after(() => rec.stop());
  await rec.start();
  assert.deepEqual(rec.range, { fmin: 1, fmax: 2 });
});

// frameSizeForInstrument: the analysis-frame-size bug. src/audio/yin.js caps
// its lag search at (frameSize >> 1) - 1 samples, so a genuine low
// fundamental needs a big enough frame to autocorrelate against at all.
// src/audio/pitch-worklet.js defaults every instrument to frameSize 2048
// regardless of how low it plays -- at 48 kHz that caps the search at 1023
// samples, well short of the ~1165 samples a 4-string bass's open E
// (41.2 Hz, bass.js range.low 28) or the ~1555 samples a 5-string bass's
// open B (30.87 Hz, bass-5-string.js range.low 23) actually need.
test('frameSizeForInstrument stays at the 2048 default for an ordinary-range instrument', () => {
  assert.equal(frameSizeForInstrument(flute, 48000), MIN_FRAME_SIZE);
  assert.equal(frameSizeForInstrument(gtr, 48000), MIN_FRAME_SIZE);
});

test('frameSizeForInstrument doubles to 4096 for the 4-string bass (open E, 41.2 Hz)', () => {
  assert.equal(frameSizeForInstrument(bass, 48000), 4096);
});

test('frameSizeForInstrument doubles to 4096 for the 5-string bass (open B0, 30.87 Hz)', () => {
  assert.equal(frameSizeForInstrument(bass5String, 48000), 4096);
});

test('frameSizeForInstrument scales with the real sample rate, not a hardcoded 48kHz', () => {
  // At 44.1kHz a given period is *fewer* samples than at 48kHz for the same
  // Hz, so 4096 must still comfortably cover it -- this is not a coincidence
  // of one particular sample rate.
  assert.equal(frameSizeForInstrument(bass5String, 44100), 4096);
});

test('frameSizeForInstrument falls back to the 2048 default with no record or a bad sample rate', () => {
  assert.equal(frameSizeForInstrument(null, 48000), MIN_FRAME_SIZE);
  assert.equal(frameSizeForInstrument(bass5String, 0), MIN_FRAME_SIZE);
  assert.equal(frameSizeForInstrument(bass5String, undefined), MIN_FRAME_SIZE);
});

test('frameSizeForInstrument never returns a global default above 2048 for a high instrument (latency guard)', () => {
  // Only instruments that actually need it get bumped -- 4096 must not
  // become the blanket default (it doubles analysis latency to ~85ms @48kHz).
  assert.equal(frameSizeForInstrument(flute, 48000), MIN_FRAME_SIZE);
});
