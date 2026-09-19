import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../../src/audio/stretch/loop.js';

test('setLoop snaps A/B points to the nearest supplied beat times', () => {
  const t = createTransport({ durationSec: 10, beatTimes: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0] });
  const loop = t.setLoop(0.42, 2.6);
  assert.equal(loop.start, 0.5);
  assert.equal(loop.end, 2.5);
  assert.deepEqual(t.getLoop(), { start: 0.5, end: 2.5 });
});

test('setLoop with no beat grid keeps the raw times', () => {
  const t = createTransport({ durationSec: 10 });
  const loop = t.setLoop(1.1, 3.3);
  assert.equal(loop.start, 1.1);
  assert.equal(loop.end, 3.3);
});

test('setLoop rejects end <= start', () => {
  const t = createTransport({ durationSec: 10 });
  assert.throws(() => t.setLoop(2, 2));
  assert.throws(() => t.setLoop(3, 1));
});

test('count-in length is beats scaled by tempo', () => {
  const t = createTransport({ durationSec: 10 });
  t.setCountInBeats(4);
  assert.equal(t.getCountInBeats(), 4);
  assert.equal(t.countInSeconds(120), 2); // 4 beats @120bpm = 2s
  assert.equal(t.countInSeconds(60), 4);
  assert.equal(t.countInSeconds(0), 0);
});

test('positionAfter wraps within the loop at rate 1', () => {
  const t = createTransport({ durationSec: 10 });
  t.setLoop(1, 3); // loop length 2s
  assert.equal(t.positionAfter(0, 1), 1);
  assert.equal(t.positionAfter(0.5, 1), 1.5);
  assert.equal(t.positionAfter(2, 1), 1); // exactly one full loop -> wraps to start
  assert.ok(Math.abs(t.positionAfter(2.5, 1) - 1.5) < 1e-9);
});

test('positionAfter scales source progress by rate (slow playback consumes source slower)', () => {
  const t = createTransport({ durationSec: 10 });
  t.setLoop(0, 4); // loop length 4s
  // At rate 0.5 (half speed), 2 output-seconds only advances 1 source-second.
  assert.ok(Math.abs(t.positionAfter(2, 0.5) - 1) < 1e-9);
  // At rate 1.25, 2 output-seconds advances 2.5 source-seconds.
  assert.ok(Math.abs(t.positionAfter(2, 1.25) - 2.5) < 1e-9);
});

test('positionAfter handles a zero/negative-length loop by pinning to loopStart', () => {
  const t = createTransport({ durationSec: 10 });
  t.setLoop(0, 0.0001);
  // extremely short but valid loop still resolves to a finite position
  assert.ok(Number.isFinite(t.positionAfter(5, 1)));
});

test('loopCountAfter counts full passes through the loop', () => {
  const t = createTransport({ durationSec: 10 });
  t.setLoop(0, 2); // loop length 2s
  assert.equal(t.loopCountAfter(0, 1), 0);
  assert.equal(t.loopCountAfter(1.9, 1), 0);
  assert.equal(t.loopCountAfter(2, 1), 1);
  assert.equal(t.loopCountAfter(5.9, 1), 2);
});

test('rate starts at 1.0 and the ladder slows 10% after a miss', () => {
  const t = createTransport({ durationSec: 10 });
  assert.equal(t.getRate(), 1.0);
  assert.ok(Math.abs(t.onMiss() - 0.9) < 1e-9);
  assert.ok(Math.abs(t.getRate() - 0.9) < 1e-9);
});

test('the ladder speeds up 5% after a clean loop', () => {
  const t = createTransport({ durationSec: 10 });
  t.setRate(0.8);
  const r = t.onCleanLoop();
  assert.ok(Math.abs(r - 0.84) < 1e-9);
});

test('the ladder is capped between 50% and 100%', () => {
  const t = createTransport({ durationSec: 10 });
  for (let i = 0; i < 30; i++) t.onMiss();
  assert.equal(t.getRate(), 0.5);
  for (let i = 0; i < 30; i++) t.onCleanLoop();
  assert.equal(t.getRate(), 1.0);
});

test('setRate itself clamps into the ladder range', () => {
  const t = createTransport({ durationSec: 10 });
  assert.equal(t.setRate(1.5), 1.0);
  assert.equal(t.setRate(0.1), 0.5);
  assert.equal(t.setRate(0.75), 0.75);
});
