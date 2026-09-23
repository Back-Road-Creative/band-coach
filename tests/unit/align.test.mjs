import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { alignNotes } from '../../src/song/align.js';
import { starterSongs } from '../../src/song/starter/index.js';

// A simple ascending melody, evenly spaced quarter notes at 1s apart,
// standing in for a song already converted to seconds (the shape align.js
// takes is agnostic to ticks vs seconds — the caller converts).
function melody(midis, spacing = 1) {
  return midis.map((midi, i) => ({ midi, start: i * spacing, dur: spacing * 0.9 }));
}

test('identical take: everything pairs, nothing missed or extra', () => {
  const ref = melody([60, 62, 64, 65, 67]);
  const take = melody([60, 62, 64, 65, 67]);
  const r = alignNotes(ref, take);
  assert.equal(r.pairs.length, ref.length);
  assert.equal(r.missed.length, 0);
  assert.equal(r.extra.length, 0);
  for (let i = 0; i < ref.length; i++) assert.deepEqual(r.pairs[i], { refIndex: i, takeIndex: i });
});

test('same take 30% slower with a gradual ritardando: still all paired', () => {
  const midis = [60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60];
  const ref = melody(midis, 0.5);
  // 30% slower overall, plus a ramp that stretches later notes even more
  // (a ritardando): local spacing grows note to note.
  const take = [];
  let t = 0;
  for (let i = 0; i < midis.length; i++) {
    take.push({ midi: midis[i], start: t, dur: 0.4 });
    const localFactor = 1.3 * (1 + i * 0.03);
    t += 0.5 * localFactor;
  }
  const r = alignNotes(ref, take);
  assert.equal(r.pairs.length, ref.length, 'every ref note should still pair under tempo drift');
  assert.equal(r.missed.length, 0);
  assert.equal(r.extra.length, 0);
  for (let i = 0; i < ref.length; i++) assert.deepEqual(r.pairs[i], { refIndex: i, takeIndex: i });
});

test('one wrong note: still paired, but the pitch mismatch is visible at that pair', () => {
  const ref = melody([60, 62, 64, 65, 67]);
  const take = melody([60, 62, 70, 65, 67]); // index 2 wrong
  const r = alignNotes(ref, take);
  assert.equal(r.pairs.length, ref.length);
  assert.equal(r.missed.length, 0);
  assert.equal(r.extra.length, 0);
  const wrongPair = r.pairs.find((p) => p.refIndex === 2);
  assert.ok(wrongPair);
  assert.notEqual(ref[wrongPair.refIndex].midi, take[wrongPair.takeIndex].midi);
});

test('one dropped note: exactly one missed, rest paired', () => {
  const ref = melody([60, 62, 64, 65, 67]);
  const midis = [60, 62, 64, 65, 67];
  const take = melody([midis[0], midis[1], midis[3], midis[4]]); // dropped index 2 (64)
  const r = alignNotes(ref, take);
  assert.equal(r.missed.length, 1);
  assert.equal(r.missed[0], 2);
  assert.equal(r.extra.length, 0);
  assert.equal(r.pairs.length, ref.length - 1);
});

test('one extra note: exactly one extra, rest paired', () => {
  const ref = melody([60, 62, 64, 65, 67]);
  const take = melody([60, 62, 99, 64, 65, 67]); // extra note (99) inserted at index 2
  const r = alignNotes(ref, take);
  assert.equal(r.extra.length, 1);
  assert.equal(r.extra[0], 2);
  assert.equal(r.missed.length, 0);
  assert.equal(r.pairs.length, ref.length);
});

test('a starter song melody with +/-40ms jitter and 0.8x tempo: all notes pair', () => {
  const song = starterSongs.find((s) => s.id === 'twinkle-twinkle');
  assert.ok(song, 'twinkle-twinkle should exist in the starter library');
  const notes = song.parts[0].notes;
  const ticksToSec = (ticks) => (ticks / song.ticksPerQuarter) * (60 / song.bpm);
  const ref = notes.map((n) => ({ midi: n.midi, start: ticksToSec(n.start), dur: ticksToSec(n.dur) }));

  // Deterministic pseudo-random jitter so the test is stable across runs.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const take = ref.map((n) => {
    const jitterSec = (rand() * 2 - 1) * 0.04; // +/- 40ms
    return { midi: n.midi, start: Math.max(0, n.start / 0.8 + jitterSec), dur: n.dur / 0.8 };
  });
  take.sort((a, b) => a.start - b.start);

  const r = alignNotes(ref, take, { band: 8 });
  assert.equal(r.pairs.length, ref.length, `expected all ${ref.length} notes to pair; missed=${JSON.stringify(r.missed)} extra=${JSON.stringify(r.extra)}`);
  assert.equal(r.missed.length, 0);
  assert.equal(r.extra.length, 0);
});

test('run time on the longest starter melody is reported', () => {
  const longest = starterSongs.reduce((a, b) => (b.parts[0].notes.length > a.parts[0].notes.length ? b : a));
  const notes = longest.parts[0].notes;
  const ticksToSec = (ticks) => (ticks / longest.ticksPerQuarter) * (60 / longest.bpm);
  const ref = notes.map((n) => ({ midi: n.midi, start: ticksToSec(n.start), dur: ticksToSec(n.dur) }));
  const take = ref.map((n) => ({ ...n, start: n.start / 0.8 }));
  const t0 = performance.now();
  const r = alignNotes(ref, take);
  const elapsedMs = performance.now() - t0;
  console.log(`align.js: ${longest.id} (${notes.length} notes) aligned in ${elapsedMs.toFixed(3)}ms`);
  assert.equal(r.pairs.length, ref.length);
  assert.ok(elapsedMs < 500, `alignment of ${notes.length} notes took ${elapsedMs}ms`);
});
