// src/song/ident.js: the one place every song producer (importers, mic take
// capture) names a song. The title in the file wins for display, the file's
// own name wins for the id, and a plain label for the kind of source is the
// last resort, so no song ever reaches validateSong without an id and title.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, songIdentity } from '../../src/song/ident.js';

test('slugify lower-cases, collapses runs of other characters to one dash and trims the ends', () => {
  assert.equal(slugify(' --Hello,  World!! '), 'hello-world');
  assert.equal(slugify('A_B  C'), 'a-b-c');
});

test('slugify folds accented letters before a space and accepts non-strings', () => {
  assert.equal(slugify('Café Noir'), 'cafe-noir');
  assert.equal(slugify(42), '42');
});

test('slugify gives an empty string when nothing slug-safe is left', () => {
  assert.equal(slugify('日本語'), '');
  assert.equal(slugify('!!!'), '');
});

test('a title with no file name: the title shows and slugs into the id', () => {
  assert.deepEqual(songIdentity({ title: 'Café Noir', fallback: 'Imported song' }), { id: 'cafe-noir', title: 'Café Noir' });
});

test('the title in the file wins for display; the file name wins for the id', () => {
  assert.deepEqual(
    songIdentity({ title: 'Real Title', fileName: 'file-name.gp5', fallback: 'Imported song' }),
    { id: 'file-name', title: 'Real Title' }
  );
});

test('a blank title falls back to the file name, with the directory and the last extension removed', () => {
  assert.deepEqual(
    songIdentity({ title: '   ', fileName: 'C:\\songs\\My Tune.v2.mid', fallback: 'Imported MIDI' }),
    { id: 'my-tune-v2', title: 'My Tune.v2' }
  );
  assert.deepEqual(
    songIdentity({ fileName: '/home/me/Blue Bossa.mid', fallback: 'Imported MIDI' }),
    { id: 'blue-bossa', title: 'Blue Bossa' }
  );
});

test('a file name with no extension is used whole', () => {
  assert.deepEqual(songIdentity({ title: 'Hi', fileName: 'noext', fallback: 'x' }), { id: 'noext', title: 'Hi' });
});

test('no title and no file name: the plain label for the source kind names the song', () => {
  assert.deepEqual(songIdentity({ fallback: 'Mic take' }), { id: 'mic-take', title: 'Mic take' });
  assert.deepEqual(songIdentity({ title: null, fileName: '', fallback: 'Mic take' }), { id: 'mic-take', title: 'Mic take' });
});

test('a file that is only an extension has no usable name, so the fallback is used', () => {
  assert.deepEqual(songIdentity({ fileName: '/a/b/.hidden', fallback: 'Imported song' }), { id: 'imported-song', title: 'Imported song' });
});

test('a title with no slug-safe characters still gets an id from the fallback label', () => {
  assert.deepEqual(songIdentity({ title: '日本語', fallback: 'Mic take' }), { id: 'mic-take', title: '日本語' });
});

test('a non-string title is turned into text, not thrown on', () => {
  assert.deepEqual(songIdentity({ title: 1999, fallback: 'x' }), { id: '1999', title: '1999' });
});
