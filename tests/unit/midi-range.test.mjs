// F13 (range half): learn the keyboard's lowest and highest key, then keep a
// lesson's notes inside it. Pure functions only; the UI wiring is pinned in
// tests/characterization/midi-range.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCapture, captureNote, fitToRange, rangeKeys, sanitizeRange, sanitizeRanges, MIN_SPAN } from '../../src/core/midi-range.js';

test('capturing the lowest then the highest key gives the range', () => {
  let s = startCapture(); assert.equal(s.step, 'low');
  s = captureNote(s, 48, 90); assert.equal(s.step, 'high'); assert.equal(s.low, 48);
  s = captureNote(s, 72, 90); assert.equal(s.step, 'done');
  assert.deepEqual(s.range, { low: 48, high: 72 });
  assert.equal(rangeKeys(s.range), 25);
});

test('a note-on with velocity 0 is a release, not a key', () => {
  const s = startCapture();
  assert.equal(captureNote(s, 48, 0), s);
});

test('a highest key that is not above the lowest, or under an octave away, is refused with a reason and capture keeps waiting', () => {
  let s = captureNote(startCapture(), 60, 80);
  const same = captureNote(s, 60, 80); assert.equal(same.step, 'high'); assert.equal(same.reason, 'not-higher'); assert.equal(same.low, 60);
  const below = captureNote(s, 50, 80); assert.equal(below.step, 'high'); assert.equal(below.reason, 'not-higher');
  const narrow = captureNote(s, 60 + MIN_SPAN - 1, 80); assert.equal(narrow.step, 'high'); assert.equal(narrow.reason, 'too-narrow'); assert.equal(narrow.range, undefined);
  assert.equal(captureNote(s, 60 + MIN_SPAN, 80).step, 'done');
});

test('fitToRange moves a phrase above the range down a whole octave', () => {
  const r = fitToRange([74, 76, 79], { low: 48, high: 72 });
  assert.deepEqual(r, { notes: [62, 64, 67], fits: true, shift: -12 });
});

test('fitToRange moves a phrase below the range up, by the smallest number of octaves', () => {
  assert.deepEqual(fitToRange([36, 40], { low: 48, high: 72 }), { notes: [48, 52], fits: true, shift: 12 });
  assert.deepEqual(fitToRange([100, 103], { low: 48, high: 72 }), { notes: [64, 67], fits: true, shift: -36 });
});

test('a phrase already inside the range is left alone', () => {
  assert.deepEqual(fitToRange([50, 60], { low: 48, high: 72 }), { notes: [50, 60], fits: true, shift: 0 });
});

test('a phrase wider than the range is reported as not fitting and unchanged', () => {
  const notes = [40, 80];
  assert.deepEqual(fitToRange(notes, { low: 48, high: 72 }), { notes: [40, 80], fits: false, shift: 0 });
});

test('a phrase narrower than the range but with no whole-octave fit is reported as not fitting and unchanged', () => {
  assert.deepEqual(fitToRange([48, 59], { low: 49, high: 61 }), { notes: [48, 59], fits: false, shift: 0 });
});

test('no stored range means no change', () => {
  for (const range of [null, undefined, {}, { low: 70, high: 60 }]) assert.deepEqual(fitToRange([20, 120], range), { notes: [20, 120], fits: true, shift: 0 });
  assert.deepEqual(fitToRange([], { low: 48, high: 72 }), { notes: [], fits: true, shift: 0 });
});

test('stored ranges are sanitized: whole numbers 0-127, low below high, per named device', () => {
  assert.deepEqual(sanitizeRange({ low: 48.4, high: 72 }), { low: 48, high: 72 });
  for (const bad of [null, 'x', {}, { low: 72, high: 48 }, { low: 60, high: 60 }, { low: -1, high: 60 }, { low: 10, high: 128 }, { low: 'a', high: 90 }]) assert.equal(sanitizeRange(bad), null);
  assert.deepEqual(sanitizeRanges({ 'Keystation 49': { low: 36, high: 96 }, Bad: { low: 5, high: 5 }, '': { low: 1, high: 50 }, __proto__: { low: 1, high: 50 } }), { 'Keystation 49': { low: 36, high: 96 } });
  assert.deepEqual(sanitizeRanges(null), {});
  assert.deepEqual(sanitizeRanges([1, 2]), {});
});
