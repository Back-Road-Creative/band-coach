// F17: six folk tunes in their usual keys (src/song/starter/folk.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterFolkTunes, starterSongs, starterGrooves } from '../../src/song/starter/index.js';
import { validateSong } from '../../src/song/model.js';
import { feasibility } from '../../src/song/feasibility.js';
import { byId } from '../../src/instruments/index.js';

const level = (id, instId) => {
  const song = starterFolkTunes.find((s) => s.id === id);
  return feasibility(song, song.parts[0].id, byId[instId]).level;
};

test('six folk tunes, each a valid song with a public-domain source', () => {
  assert.equal(starterFolkTunes.length, 6);
  for (const song of starterFolkTunes) {
    const v = validateSong(song);
    assert.ok(v.ok, `${song.id}: ${v.errors && v.errors.join('; ')}`);
    assert.equal(song.licence, 'Public domain', song.id);
    assert.match(song.source, /made for Band Coach/, song.id);
  }
  assert.match(starterFolkTunes.find((s) => s.id === 'oh-susanna').composer, /Stephen Foster/);
});

test('folk ids are unique and collide with no other starter', () => {
  const ids = starterFolkTunes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const others = new Set([...starterSongs, ...starterGrooves].map((s) => s.id));
  for (const id of ids) assert.ok(!others.has(id), id);
});

test('the usual keys fit the instruments they are played on', () => {
  assert.equal(level('soldiers-joy', 'violin'), 'as-written');
  assert.equal(level('red-river-valley', 'mandolin'), 'as-written');
  assert.equal(level('oh-susanna', 'harp'), 'as-written');
  assert.equal(starterFolkTunes.find((s) => s.id === 'yankee-doodle').key.tonic, 10);
});
