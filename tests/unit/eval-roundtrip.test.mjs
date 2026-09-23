import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterSongs } from '../../src/song/starter/index.js';
import { FAMILY_PROFILES, evaluateAll } from '../../src/song/eval/roundtrip.js';

// Floors below are the MEASURED per-family mean F1 (see roundtrip.js
// FAMILY_PROFILES / evaluateAll), rounded DOWN to the nearest 0.05, run
// against the starter songs (src/song/starter/index.js) on 2026-09-22.
// Measured values that day: keys/fretted/bowed/free-reed 0.8436,
// wind/brass 0.8099, voice 0.7790 (`node -e` over evaluateAll(), see the
// commit that added this file). keys/fretted/bowed/free-reed land on the
// same number because transcribe() is given no onset hints, so a run of
// same-pitch repeated notes (e.g. "C4:q C4:q C4:q C4:q" in Hot Cross Buns)
// fuses into one note regardless of the profile's small pitch wobble or
// timing jitter -- a real, measured limitation of the pipeline (no
// onset detector wired in yet), not a bug in this harness.
// A regression below floor is a real drop in transcription quality, not a
// chosen target -- if the transcription pipeline changes on purpose and
// scores improve, raise the floor and record the new measured value and
// date here.
const FAMILY_FLOORS = {
  keys: 0.8,
  fretted: 0.8,
  bowed: 0.8,
  wind: 0.8,
  brass: 0.8,
  'free-reed': 0.8,
  voice: 0.75,
};

test('round-trip render -> transcribe -> score prints F1 per starter song and per family', () => {
  const result = evaluateAll();

  console.log('\nF1 per starter song (keys profile):');
  result.perSong.forEach((row) => {
    console.log(`  ${row.title.padEnd(32)} f1=${row.f1.toFixed(3)} (matched ${row.matched}/${row.ref}, est ${row.est})`);
  });

  console.log('\nF1 per instrument family (mean over all starter songs):');
  result.perFamily.forEach((row) => {
    console.log(`  ${row.family.padEnd(10)} f1=${row.meanF1.toFixed(3)}`);
  });
  console.log('');

  assert.equal(result.perSong.length, starterSongs.length);
  assert.equal(Object.keys(FAMILY_PROFILES).length, result.perFamily.length);

  result.perSong.forEach((row) => {
    assert.ok(Number.isFinite(row.f1), `${row.title}: f1 must be a finite number, got ${row.f1}`);
  });

  result.perFamily.forEach((row) => {
    const floor = FAMILY_FLOORS[row.family];
    assert.ok(typeof floor === 'number', `no measured floor recorded for family "${row.family}"`);
    assert.ok(
      row.meanF1 >= floor,
      `family "${row.family}": mean F1 ${row.meanF1.toFixed(3)} fell below its measured floor ${floor}`
    );
  });
});

test('every starter song round-trips through render -> transcribe with no error, on every family profile', () => {
  for (const family of Object.keys(FAMILY_PROFILES)) {
    for (const song of starterSongs) {
      assert.doesNotThrow(() => evaluateAll({ families: [family], songs: [song] }));
    }
  }
});
