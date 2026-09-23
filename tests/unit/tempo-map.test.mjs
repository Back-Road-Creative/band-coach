import test from 'node:test';
import assert from 'node:assert/strict';
import { tempoMapFromBeats, tickToSeconds, secondsToTick, estimateSwing } from '../../src/audio/analysis/tempo-map.js';

const PPQ = 480;

// Synthesizes 17 beat times (16 beats) with bpm ramping linearly 120 -> 90, i.e. a ritardando.
function ritardandoBeats(startBpm, endBpm, beatCount) {
  const times = [0];
  for (let i = 0; i < beatCount; i++) {
    const bpm = startBpm + ((endBpm - startBpm) * i) / (beatCount - 1);
    const dt = 60 / bpm;
    times.push(times[times.length - 1] + dt);
  }
  return times;
}

test('tempoMapFromBeats: a ritardando quantises every beat onto the grid within 1/32 note', () => {
  const beats = ritardandoBeats(120, 90, 16);
  const map = tempoMapFromBeats(beats, { ppq: PPQ });
  assert.ok(map.length > 1, 'a ritardando should not collapse to a single constant-tempo segment');
  const thirtySecond = PPQ / 8; // a 1/32 note in ticks at PPQ=480
  for (let i = 0; i < beats.length; i++) {
    const tick = secondsToTick(map, beats[i], PPQ);
    const expectedTick = i * PPQ;
    assert.ok(Math.abs(tick - expectedTick) <= thirtySecond,
      `beat ${i}: tick ${tick} not within 1/32 note of expected ${expectedTick}`);
  }
});

test('tempoMapFromBeats: a constant-tempo track collapses to one segment', () => {
  const beats = ritardandoBeats(126, 126, 16);
  const map = tempoMapFromBeats(beats, { ppq: PPQ });
  assert.equal(map.length, 1);
  assert.equal(map[0].tick, 0);
  assert.ok(Math.abs(map[0].bpm - 126) < 0.5);
});

test('tempoMapFromBeats: too few beats returns a single fallback-tempo entry', () => {
  assert.deepEqual(tempoMapFromBeats([]), [{ tick: 0, bpm: 120 }]);
  assert.deepEqual(tempoMapFromBeats([0.5]), [{ tick: 0, bpm: 120 }]);
  assert.deepEqual(tempoMapFromBeats([0, 0.5], { fallbackBpm: 100 }).length, 1);
});

test('tempoMapFromBeats: entries are sorted by tick with tick 0 first and bpm > 0 (Song model shape)', () => {
  const beats = ritardandoBeats(120, 90, 16);
  const map = tempoMapFromBeats(beats, { ppq: PPQ });
  assert.equal(map[0].tick, 0);
  let prevTick = -1;
  for (const entry of map) {
    assert.ok(Number.isInteger(entry.tick) && entry.tick >= 0);
    assert.ok(entry.tick > prevTick || entry === map[0]);
    assert.ok(entry.bpm > 0);
    prevTick = entry.tick;
  }
});

test('secondsToTick/tickToSeconds round-trip through a multi-segment tempo map', () => {
  const beats = ritardandoBeats(120, 90, 16);
  const map = tempoMapFromBeats(beats, { ppq: PPQ });
  for (const sec of [0, 0.31, 1.2, 3.7, beats[beats.length - 1]]) {
    const tick = secondsToTick(map, sec, PPQ);
    const back = tickToSeconds(map, tick, PPQ);
    assert.ok(Math.abs(back - sec) < 1e-6, `round trip drifted: ${sec} -> ${tick} -> ${back}`);
  }
});

test('secondsToTick/tickToSeconds round-trip through a single-segment (constant tempo) map', () => {
  const map = [{ tick: 0, bpm: 100 }];
  for (const tick of [0, 240, 480, 1920, 4800]) {
    const sec = tickToSeconds(map, tick, PPQ);
    const back = secondsToTick(map, sec, PPQ);
    assert.ok(Math.abs(back - tick) < 1e-6);
  }
});

test('estimateSwing: straight eighths (onset at the midpoint) reads ~1.0', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0];
  const onsets = beats.slice(0, -1).map((b) => b + 0.25); // exact midpoint of each interval
  const ratio = estimateSwing(onsets, beats);
  assert.ok(Math.abs(ratio - 1.0) < 0.05, `expected ~1.0, got ${ratio}`);
});

test('estimateSwing: triplet swing (onset at 2/3) reads ~2.0', () => {
  const beats = [0, 0.6, 1.2, 1.8, 2.4];
  const onsets = beats.slice(0, -1).map((b, i) => b + (beats[i + 1] - b) * (2 / 3));
  const ratio = estimateSwing(onsets, beats);
  assert.ok(Math.abs(ratio - 2.0) < 0.05, `expected ~2.0, got ${ratio}`);
});

test('estimateSwing: no usable off-beat onsets (silence between beats) reads straight, not a fabricated swing', () => {
  const beats = [0, 0.5, 1.0, 1.5];
  const ratio = estimateSwing([], beats);
  assert.equal(ratio, 1.0);
});
