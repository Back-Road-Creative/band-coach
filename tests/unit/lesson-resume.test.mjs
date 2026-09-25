import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  songRevision,
  tempoKey,
  lessonKey,
  sameLessonKey,
  sanitizeLessonEntry,
  sanitizeLessonList,
  rememberLesson,
  findLesson,
  resultsTail,
  LESSONS_MAX,
  TAIL_MAX
} from '../../src/song/lesson-resume.js';

import { arrangeFor, arrangementKey } from '../../src/song/arrange/index.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { instrumentSetup } from '../../src/ui/fingerings/setup.js';
import starterSongs from '../../src/song/starter/index.js';

const gtr = INSTRUMENTS.find((r) => r.id === 'gtr');
const harp = INSTRUMENTS.find((r) => r.id === 'harp');

function hotCrossBuns() {
  // Deep-enough clone: songRevision only reads primitives/arrays this deep.
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  return JSON.parse(JSON.stringify(song));
}

function baseArrangement(song, instrument, setupOverrides) {
  const part = song.parts.find((p) => p.id === 'melody');
  const setup = Object.assign({ capo: 0, tuning: null, tuningMidi: instrument.tuning, leftHanded: false, harpKey: 0, voiceRange: null }, setupOverrides);
  return arrangeFor(part.notes, instrument, setup);
}

function makeLessonKey(song, instrument, { partId = 'melody', setupOverrides, assistance = 'none' } = {}) {
  const arrangement = baseArrangement(song, instrument, setupOverrides);
  return lessonKey({ song, partId, instrumentId: instrument.id, setup: setupOverrides, arrangement, assistance });
}

test('the same song, part, instrument and setup give the same lesson key', () => {
  const song = hotCrossBuns();
  const a = makeLessonKey(song, gtr);
  const b = makeLessonKey(song, gtr);
  assert.equal(sameLessonKey(a, b), true);
});

test('editing one note changes the song revision', () => {
  const song = hotCrossBuns();
  const before = songRevision(song, 'melody');
  const edited = JSON.parse(JSON.stringify(song));
  edited.parts[0].notes[0].midi += 1;
  const after = songRevision(edited, 'melody');
  assert.notEqual(before, after);
  assert.equal(edited.id, song.id);
});

test('renaming a song does not change its revision', () => {
  const song = hotCrossBuns();
  const before = songRevision(song, 'melody');
  const renamed = JSON.parse(JSON.stringify(song));
  renamed.title = 'Something else entirely';
  const after = songRevision(renamed, 'melody');
  assert.equal(before, after);
});

test('a tempo change is a different lesson, but not a different revision', () => {
  const song = hotCrossBuns();
  const faster = JSON.parse(JSON.stringify(song));
  faster.bpm = 90;
  const a = makeLessonKey(song, gtr);
  const b = makeLessonKey(faster, gtr);
  assert.notEqual(a.tempo, b.tempo);
  assert.equal(a.rev, b.rev);
  assert.equal(tempoKey(song) !== tempoKey(faster), true);
});

test('a new capo is a different lesson', () => {
  const song = hotCrossBuns();
  const capo0 = makeLessonKey(song, gtr, { setupOverrides: { capo: 0 } });
  const capo2 = makeLessonKey(song, gtr, { setupOverrides: { capo: 2 } });
  assert.notEqual(capo0.arrangement, capo2.arrangement);
  assert.equal(sameLessonKey(capo0, capo2), false);
});

test('a different harmonica key is a different lesson even when the arrangement text matches', () => {
  const song = hotCrossBuns();
  const part = song.parts.find((p) => p.id === 'melody');
  // Keys 1 and 2 both fail Hot Cross Buns' fit on a C harp, so both give the
  // same "best on a C harmonica" advice text and the same shift (0) -- the
  // arrangement text genuinely matches, only the learner's chosen key differs.
  const setupC = { capo: 0, tuning: null, tuningMidi: harp.tuning, leftHanded: false, harpKey: 1, voiceRange: null };
  const setupD = { capo: 0, tuning: null, tuningMidi: harp.tuning, leftHanded: false, harpKey: 2, voiceRange: null };
  const arrC = arrangeFor(part.notes, harp, setupC);
  const arrD = arrangeFor(part.notes, harp, setupD);
  // The arrangement text itself matches (free-reed has no capo/tuning move).
  assert.equal(arrangementKey(arrC), arrangementKey(arrD));
  const keyC = lessonKey({ song, partId: 'melody', instrumentId: harp.id, setup: setupC, arrangement: arrC, assistance: 'none' });
  const keyD = lessonKey({ song, partId: 'melody', instrumentId: harp.id, setup: setupD, arrangement: arrD, assistance: 'none' });
  assert.notEqual(keyC.setup, keyD.setup);
  assert.equal(sameLessonKey(keyC, keyD), false);
});

test('left-handed view alone is still the same lesson', () => {
  const song = hotCrossBuns();
  const a = makeLessonKey(song, gtr, { setupOverrides: { capo: 0, leftHanded: false } });
  const b = makeLessonKey(song, gtr, { setupOverrides: { capo: 0, leftHanded: true } });
  assert.equal(sameLessonKey(a, b), true);
});

test('another part or another instrument is a different lesson', () => {
  const song = hotCrossBuns();
  // Give the song a second part so partId actually differs.
  song.parts.push(JSON.parse(JSON.stringify(song.parts[0])));
  song.parts[1].id = 'second';
  const melodyKey = makeLessonKey(song, gtr, { partId: 'melody' });
  const secondPartKey = makeLessonKey(song, gtr, { partId: 'second' });
  assert.equal(sameLessonKey(melodyKey, secondPartKey), false);

  const kbd = INSTRUMENTS.find((r) => r.id === 'kbd');
  const otherInstrumentKey = makeLessonKey(song, kbd);
  const gtrKey = makeLessonKey(song, gtr);
  assert.equal(sameLessonKey(gtrKey, otherInstrumentKey), false);
});

test('a saved entry pointing past the end of the lesson is dropped', () => {
  const key = { songId: 's', rev: 'r', partId: 'melody', arrangement: 'a', setup: 'gtr|0|', tempo: '0:100', assist: 'none' };
  const finished = sanitizeLessonEntry({ key, stepIndex: 5, tail: [], level: 1, rate: 1 }, 5);
  assert.equal(finished, null);
  const stillGoing = sanitizeLessonEntry({ key, stepIndex: 4, tail: [], level: 1, rate: 1 }, 5);
  assert.notEqual(stillGoing, null);
  assert.equal(stillGoing.stepIndex, 4);
});

test('junk in the saved list is dropped, never thrown', () => {
  const junk = [null, 'not an object', undefined, 42, { key: null, stepIndex: -1, tail: [], level: 1, rate: 1 }];
  const validKey = { songId: 's', rev: 'r', partId: 'p', arrangement: 'a', setup: 'x', tempo: 't', assist: 'none' };
  for (let i = 0; i < 40; i++) {
    junk.push({ key: validKey, stepIndex: i, tail: [], level: 1, rate: i % 7 === 0 ? 7 : 0.5 });
  }
  assert.doesNotThrow(() => sanitizeLessonList(junk));
  const clean = sanitizeLessonList(junk);
  assert.equal(clean.length <= LESSONS_MAX, true);
  for (const entry of clean) {
    assert.equal(entry.rate === null || (entry.rate > 0 && entry.rate <= 1), true);
    assert.equal(Number.isInteger(entry.stepIndex) && entry.stepIndex >= 0, true);
  }
});

test('remembering a lesson replaces that song and part\'s older entry and keeps the newest first', () => {
  const keyA = { songId: 'song1', rev: 'r1', partId: 'melody', arrangement: 'a', setup: 's', tempo: 't', assist: 'none' };
  const keyAv2 = { songId: 'song1', rev: 'r2', partId: 'melody', arrangement: 'a', setup: 's', tempo: 't', assist: 'none' };
  const keyB = { songId: 'song2', rev: 'r1', partId: 'melody', arrangement: 'a', setup: 's', tempo: 't', assist: 'none' };
  const entryA = { key: keyA, stepIndex: 2, tail: [], level: 1, rate: null };
  const entryB = { key: keyB, stepIndex: 3, tail: [], level: 1, rate: null };
  const list1 = rememberLesson([], entryA);
  const list2 = rememberLesson(list1, entryB);
  const entryAv2 = { key: keyAv2, stepIndex: 7, tail: [], level: 1, rate: null };
  const list3 = rememberLesson(list2, entryAv2);
  assert.equal(list3.length, 2);
  assert.equal(list3[0], entryAv2);
  assert.equal(list3.some((e) => e.key.songId === 'song1' && e.key.rev === 'r1'), false);
  assert.equal(list3.some((e) => e.key.songId === 'song2'), true);
});

test('remembering never changes the list it was given', () => {
  const key = { songId: 's', rev: 'r', partId: 'p', arrangement: 'a', setup: 'x', tempo: 't', assist: 'none' };
  const original = [{ key, stepIndex: 1, tail: [], level: 1, rate: null }];
  const originalCopy = JSON.parse(JSON.stringify(original));
  const next = rememberLesson(original, { key, stepIndex: 2, tail: [], level: 1, rate: null });
  assert.deepEqual(original, originalCopy);
  assert.notEqual(next, original);

  const found = findLesson(next, key);
  assert.notEqual(found, null);
  assert.equal(found.stepIndex, 2);
  assert.equal(findLesson(next, { songId: 'nope', rev: 'r', partId: 'p', arrangement: 'a', setup: 'x', tempo: 't', assist: 'none' }), null);
});

test('only the trailing tries on the current step are kept', () => {
  const results = [
    { stepIndex: 0, passed: true },
    { stepIndex: 1, passed: false },
    { stepIndex: 1, passed: true },
    { stepIndex: 2, passed: false },
    { stepIndex: 2, passed: false },
    { stepIndex: 2, passed: true },
    { stepIndex: 2, passed: false }
  ];
  const tail = resultsTail(results, 2);
  assert.equal(tail.every((r) => r.stepIndex === 2), true);
  assert.equal(tail.length, 4);
  assert.deepEqual(tail.map((r) => r.passed), [false, false, true, false]);

  // Capped at TAIL_MAX even with a long run on the same step.
  const long = [];
  for (let i = 0; i < TAIL_MAX + 5; i++) long.push({ stepIndex: 9, passed: i % 2 === 0 });
  const longTail = resultsTail(long, 9);
  assert.equal(longTail.length, TAIL_MAX);
});
