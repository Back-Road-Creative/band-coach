import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lessonKey, sameLessonKey, sanitizeLessonEntry, rememberLesson, findLesson } from '../../src/song/lesson-resume.js';
import { arrangeFor } from '../../src/song/arrange/index.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import starterSongs from '../../src/song/starter/index.js';

const kbd = INSTRUMENTS.find((r) => r.id === 'kbd');

function hotCrossBuns() {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  return JSON.parse(JSON.stringify(song));
}

function keyFor(hands) {
  const song = hotCrossBuns();
  const part = song.parts.find((p) => p.id === 'melody');
  const setup = { capo: 0, tuning: null, tuningMidi: kbd.tuning, leftHanded: false, harpKey: 0, voiceRange: null };
  const arrangement = arrangeFor(part.notes, kbd, setup);
  const args = { song, partId: 'melody', instrumentId: kbd.id, setup, arrangement, assistance: 'none' };
  if (hands !== undefined) args.hands = hands;
  return lessonKey(args);
}

test('no hand selection or both hands keeps today\'s key byte-for-byte', () => {
  assert.deepEqual(keyFor(undefined), keyFor('both'));
  assert.equal(keyFor(undefined).setup, 'kbd|0||');
  const song = hotCrossBuns();
  const part = song.parts.find((p) => p.id === 'melody');
  const setup = { capo: 0, tuning: null, tuningMidi: kbd.tuning, leftHanded: false, harpKey: 0, voiceRange: null };
  const arrangement = arrangeFor(part.notes, kbd, setup);
  const noHandsArgProperty = lessonKey({ song, partId: 'melody', instrumentId: kbd.id, setup, arrangement, assistance: 'none' });
  assert.deepEqual(keyFor(undefined), noHandsArgProperty);
  assert.equal(Object.keys(keyFor('both')).length, 7);
});

test('left hand alone and right hand alone are different lessons, and both differ from both-hands', () => {
  assert.notEqual(keyFor('left').setup, keyFor('right').setup);
  assert.equal(sameLessonKey(keyFor('left'), keyFor('right')), false);
  assert.equal(sameLessonKey(keyFor('left'), keyFor('both')), false);
  assert.equal(sameLessonKey(keyFor('right'), keyFor('both')), false);
  assert.equal(keyFor('left').setup, 'kbd|0|||hands=left');
});

test('an unknown hands value is treated as both hands', () => {
  assert.deepEqual(keyFor('sideways'), keyFor('both'));
  assert.deepEqual(keyFor(null), keyFor('both'));
});

test('a saved one-hand key survives sanitizing with all seven fields', () => {
  const e = sanitizeLessonEntry({ key: keyFor('left'), stepIndex: 0, tail: [], level: 1, rate: 1 });
  assert.deepEqual(e.key, keyFor('left'));
  assert.equal(Object.keys(e.key).length, 7);
  assert.equal(findLesson([e], keyFor('left')), e);
  assert.equal(findLesson([e], keyFor('right')), null);
});

test('a one-hand lesson shares its save slot with the both-hands one', () => {
  const list = rememberLesson(
    [{ key: keyFor('both'), stepIndex: 0, tail: [], level: 1, rate: null }],
    { key: keyFor('left'), stepIndex: 0, tail: [], level: 1, rate: null }
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].key.setup.endsWith('|hands=left'), true);
});
