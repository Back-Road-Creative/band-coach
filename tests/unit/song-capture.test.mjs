import { test } from 'node:test';
import assert from 'node:assert/strict';

import { captureToSong } from '../../src/song/capture.js';
import { validateSong, SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import gtr from '../../src/instruments/gtr.js';

// cap.notes shape (src/app.js): { m: midi, t: startSec, d: durSec }.
const NOW = 1700000000000; // 2023-11-14, a fixed instant so title assertions are deterministic

function threeNotes() {
  return [
    { m: 60, t: 0, d: 0.5 },
    { m: 62, t: 0.5, d: 0.5 },
    { m: 64, t: 1.0, d: 0.5 },
  ];
}

test('captureToSong turns captured notes into a valid, normalized song', () => {
  const song = captureToSong(threeNotes(), { now: NOW, bpm: 120 });
  assert.equal(song.schema, SCHEMA);
  assert.equal(song.ticksPerQuarter, TICKS_PER_QUARTER);
  assert.equal(song.bpm, 120);
  assert.equal(song.source, 'capture');
  assert.equal(song.parts.length, 1);
  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.ok(ok);
});

test('captureToSong quantizes the ticks/durs from seconds at the given bpm', () => {
  // At 120bpm, ppq=480: one beat = 0.5s = 480 ticks.
  const song = captureToSong(threeNotes(), { now: NOW, bpm: 120 });
  const notes = song.parts[0].notes;
  assert.equal(notes.length, 3);
  assert.equal(notes[0].start, 0);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[1].start, 480);
  assert.equal(notes[1].midi, 62);
  assert.equal(notes[2].start, 960);
  assert.equal(notes[2].midi, 64);
  notes.forEach(n => assert.ok(n.dur > 0));
});

test('captureToSong titles the song "Captured tune <date>" when no name is given', () => {
  const song = captureToSong(threeNotes(), { now: NOW });
  assert.match(song.title, /^Captured tune \d{4}-\d{2}-\d{2}$/);
});

test('captureToSong uses a supplied name as the title', () => {
  const song = captureToSong(threeNotes(), { now: NOW, name: 'My riff' });
  assert.equal(song.title, 'My riff');
});

test('captureToSong defaults bpm to 90', () => {
  const song = captureToSong(threeNotes(), { now: NOW });
  assert.equal(song.bpm, 90);
});

test('captureToSong throws on empty notes', () => {
  assert.throws(() => captureToSong([], { now: NOW }), /note/);
});

test('captureToSong throws without a numeric now', () => {
  assert.throws(() => captureToSong(threeNotes(), {}), /now/);
});

test('captureToSong result is accepted by buildLessonPlan', () => {
  const song = captureToSong(threeNotes(), { now: NOW, bpm: 120 });
  const plan = buildLessonPlan(song, 'melody', gtr, { level: 1 });
  assert.ok(Array.isArray(plan.steps));
  assert.ok(plan.steps.length > 0);
});
