import { test } from 'node:test';
import assert from 'node:assert/strict';
import { make, check, LEVEL_COUNT, LEVEL_NAMES } from '../../src/core/ear/song-rhythm.js';
import { check as rhythmCheck } from '../../src/core/ear/rhythm-dictation.js';
import { validateBar } from '../../src/core/rhythm.js';
import { barsOf, notesInBar } from '../../src/song/model.js';
import { starterSongs } from '../../src/song/starter/index.js';

// Rebuilds the same gap-filled { dur, rest } events song-rhythm.js builds
// internally, from the song's own notesInBar, so a test can independently
// confirm a question's onsets are the song's own durations for that bar --
// without importing song-rhythm's private helpers.
function eventsForBar(song, boundaries, barIndex) {
  const barStart = boundaries[barIndex];
  const barEnd = boundaries[barIndex + 1];
  const notes = notesInBar(song, barIndex).map(({ note }) => note).sort((a, b) => a.start - b.start);
  const events = [];
  let cursor = barStart;
  for (const note of notes) {
    if (note.start > cursor) events.push({ dur: note.start - cursor, rest: true });
    events.push({ dur: note.dur, rest: false });
    cursor = note.start + note.dur;
  }
  if (cursor < barEnd) events.push({ dur: barEnd - cursor, rest: true });
  return events;
}

test('determinism, free-response shape, and level count', () => {
  assert.deepEqual(make(3, 8), make(3, 8));
  assert.equal(LEVEL_NAMES.length, LEVEL_COUNT);
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    for (let seed = 0; seed < 8; seed++) {
      const q = make(level, seed);
      assert.deepEqual(q.choices, []);
      assert.ok(Array.isArray(q.answer) && q.answer.length >= 1, `level ${level} seed ${seed} has at least one onset`);
      assert.equal(q.play.length, q.answer.length);
      assert.ok(typeof q.prompt === 'string' && q.prompt.length > 0);
    }
  }
});

test('the prompt names the song up front (sight-reading, not by-ear)', () => {
  for (let seed = 0; seed < 8; seed++) {
    const q = make(1, seed);
    const matchesSomeSong = starterSongs.some((s) => q.prompt.includes(`"${s.title}"`));
    assert.ok(matchesSomeSong, `prompt "${q.prompt}" does not name a starter song`);
  }
});

test('every starter song yields at least one valid bar in its own metre', () => {
  for (const song of starterSongs) {
    const boundaries = barsOf(song);
    const barCount = boundaries.length - 1;
    const metreKey = `${song.metre.num}/${song.metre.den}`;
    const anyBarValid = Array.from({ length: barCount }, (_, b) => eventsForBar(song, boundaries, b)).some((events) =>
      validateBar(events, metreKey)
    );
    assert.ok(anyBarValid, `${song.id} (${metreKey}) has no bar that validates`);
  }
});

test("level 1's question is the song's own bar-1 durations for at least one seed per song", () => {
  // Sweep enough seeds that every starter song's bar 1 gets picked at least
  // once (each seed picks a random song+bar; with 9 songs this converges
  // quickly), then check that seed's onsets are exactly that song's own
  // note durations converted to onset ticks from 0.
  const seen = new Set();
  for (let seed = 0; seed < 60 && seen.size < starterSongs.length; seed++) {
    const q = make(1, seed);
    const song = starterSongs.find((s) => q.prompt.includes(`"${s.title}"`));
    assert.ok(song, `question names a real starter song: ${q.prompt}`);
    seen.add(song.id);

    const boundaries = barsOf(song);
    const barCount = boundaries.length - 1;
    // Find which bar this question came from: its onset count and first/last
    // onset ticks must match exactly one bar's own events.
    const matchingBar = Array.from({ length: barCount }, (_, b) => eventsForBar(song, boundaries, b)).find((events) => {
      let t = 0;
      const onsets = [];
      events.forEach((ev) => {
        if (!ev.rest) onsets.push(t);
        t += ev.dur;
      });
      return JSON.stringify(onsets) === JSON.stringify(q.answer);
    });
    assert.ok(matchingBar, `level 1 seed ${seed}: onsets ${JSON.stringify(q.answer)} do not match any bar of "${song.title}"`);
  }
  assert.equal(seen.size, starterSongs.length, 'every starter song was reachable within the seed sweep');
});

test('check() is rhythm-dictation\'s own grader, reused unchanged', () => {
  assert.equal(check, rhythmCheck);
  const q = make(2, 3);
  assert.equal(check(q, q.answer).ok, true);
  const bad = q.answer.map((t) => t + 1000);
  assert.equal(check(q, bad).ok, false);
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
  assert.ok(q.prompt.includes('"Tiny Test Tune"'));
  assert.deepEqual(q.answer, [0, 480, 960, 1440]);
});
