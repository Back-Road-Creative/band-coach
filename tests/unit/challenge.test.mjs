import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHALLENGE_SCHEMA, MAX_CHALLENGE_SONGS, parseChallenge, buildChallenge
} from '../../src/song/challenge.js';
import { SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';

function song(id, overrides = {}) {
  return {
    schema: SCHEMA, id, title: overrides.title || 'Song ' + id, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }] }],
    chords: [],
    ...overrides
  };
}

// ---- buildChallenge ----

test('buildChallenge produces JSON text a teacher can hand out', () => {
  const text = buildChallenge('Term 1 tunes', [song('a'), song('b')], { from: 'Ms Rivera', note: 'Play in order' });
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema, CHALLENGE_SCHEMA);
  assert.equal(parsed.title, 'Term 1 tunes');
  assert.equal(parsed.from, 'Ms Rivera');
  assert.equal(parsed.note, 'Play in order');
  assert.equal(parsed.songs.length, 2);
});

test('buildChallenge rejects an empty title, no songs, or an invalid song', () => {
  assert.throws(() => buildChallenge('', [song('a')]), /title/);
  assert.throws(() => buildChallenge('Empty', []), /song/);
  assert.throws(() => buildChallenge('Bad', [{ id: 'x' }]), /valid song/);
});

test('buildChallenge rejects more than the song cap', () => {
  const songs = [];
  for (let i = 0; i < MAX_CHALLENGE_SONGS + 1; i++) songs.push(song('s' + i));
  assert.throws(() => buildChallenge('Too many', songs), /50/);
});

// ---- parseChallenge ----

test('parseChallenge round-trips what buildChallenge produced', () => {
  const text = buildChallenge('Term 1 tunes', [song('a'), song('b')]);
  const challenge = parseChallenge(text);
  assert.equal(challenge.schema, CHALLENGE_SCHEMA);
  assert.equal(challenge.title, 'Term 1 tunes');
  assert.equal(challenge.songs.length, 2);
  assert.equal(challenge.songs[0].id, 'a');
});

test('parseChallenge reports invalid JSON in plain English, never eval-ing it', () => {
  assert.throws(() => parseChallenge('not json at all {'), /JSON/);
  assert.throws(() => parseChallenge('1 + 1'), /object|JSON/);
});

test('parseChallenge rejects a non-matching schema instead of guessing', () => {
  assert.throws(() => parseChallenge(JSON.stringify({ schema: 'song/1', title: 'x', songs: [song('a')] })), /schema/);
});

test('parseChallenge rejects a missing title or an empty song list', () => {
  assert.throws(() => parseChallenge(JSON.stringify({ schema: CHALLENGE_SCHEMA, songs: [song('a')] })), /title/);
  assert.throws(() => parseChallenge(JSON.stringify({ schema: CHALLENGE_SCHEMA, title: 'x', songs: [] })), /song/);
});

test('parseChallenge rejects more than the song cap', () => {
  const songs = [];
  for (let i = 0; i < MAX_CHALLENGE_SONGS + 1; i++) songs.push(song('s' + i));
  assert.throws(
    () => parseChallenge(JSON.stringify({ schema: CHALLENGE_SCHEMA, title: 'Too many', songs })),
    /50/
  );
});

test('parseChallenge normalizes each song, throwing plain English if one cannot be fixed', () => {
  const challenge = parseChallenge(JSON.stringify({
    schema: CHALLENGE_SCHEMA, title: 'Loose ends', songs: [{ id: 'raw', parts: [] }]
  }));
  assert.equal(challenge.songs[0].schema, SCHEMA);
  assert.equal(challenge.songs[0].title, 'Untitled');

  assert.throws(
    () => parseChallenge(JSON.stringify({ schema: CHALLENGE_SCHEMA, title: 'Bad song', songs: [{ title: 'no id' }] })),
    /song 1/
  );
});

test('parseChallenge strips unknown top-level keys rather than keeping them', () => {
  const challenge = parseChallenge(JSON.stringify({
    schema: CHALLENGE_SCHEMA, title: 'Clean', songs: [song('a')], evil: 'DROP TABLE songs'
  }));
  assert.equal(challenge.evil, undefined);
});

test('parseChallenge never evaluates the input as code', () => {
  const text = JSON.stringify({
    schema: CHALLENGE_SCHEMA,
    title: 'constructor.constructor("return process")().exit()',
    songs: [song('a')]
  });
  const challenge = parseChallenge(text);
  assert.equal(challenge.title, 'constructor.constructor("return process")().exit()');
});
