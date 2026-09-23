import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT, LEVEL_NAMES } from '../../src/core/ear/song-dictation.js';
import { starterSongs } from '../../src/song/starter/index.js';

test('determinism, free-response shape, and level count', () => {
  assert.deepEqual(make(3, 8), make(3, 8));
  assert.equal(LEVEL_NAMES.length, LEVEL_COUNT);
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 6; seed++) {
      const q = make(level, seed);
      assert.deepEqual(q.choices, []);
      assert.ok(Array.isArray(q.answer) && q.answer.length >= 1, `level ${level} seed ${seed} has an answer`);
      assert.equal(q.play.length, q.answer.length);
      assert.ok(typeof q.prompt === 'string' && q.prompt.length > 0);
      // The song title must not leak into the prompt before reveal.
      starterSongs.forEach((s) => assert.ok(!q.prompt.includes(s.title), `prompt leaked "${s.title}"`));
    }
  }
});

test('every phrase note actually comes from one of the starter songs', () => {
  const allMidiSets = starterSongs.map((s) => new Set(s.parts[0].notes.map((n) => n.midi)));
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 10; seed++) {
      const q = make(level, seed);
      const matchesSomeSong = allMidiSets.some((set) => q.answer.every((m) => set.has(m)));
      assert.ok(matchesSomeSong, `level ${level} seed ${seed}: ${q.answer} not a subsequence of any starter song`);
    }
  }
});

test('explain reveals the song title only after reveal, and check() grades correctly', () => {
  const q = make(2, 5);
  const title = /From "(.+)"\. Notes:/.exec(q.explain)[1];
  assert.ok(starterSongs.some((s) => s.title === title), `explain names a real starter song, got "${title}"`);

  assert.equal(check(q, q.answer).ok, true);
  const bad = q.answer.slice();
  bad[0] = bad[0] + 5;
  assert.equal(check(q, bad).ok, false);
  assert.equal(check(q, q.answer.slice(0, 1)).ok, false);
});

test('a custom songs list is honoured (dependency injection, not the global starter list)', () => {
  const tinySong = {
    schema: 'song/1', id: 'tiny', title: 'Tiny Test Tune', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60 },
      { start: 480, dur: 480, midi: 62 },
      { start: 960, dur: 480, midi: 64 },
      { start: 1440, dur: 480, midi: 65 },
    ] }],
    chords: [],
  };
  const q = make(1, 0, { songs: [tinySong] });
  assert.ok(q.answer.every((m) => [60, 62, 64, 65].includes(m)));
  assert.ok(q.explain.includes('Tiny Test Tune'));
});
