import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportProgress, importProgress, migrate, PROGRESS_FORMAT, CURRENT_DB_VERSION } from '../../src/core/progress-file.js';

// Real backup files frozen in tests/fixtures/backups/ (see its README.md).
// tests/unit/progress-file.test.mjs covers the logic with in-memory data; this
// file's value is the files on disk. Calibration prefs are deliberately not asserted.
const read = (name) => readFileSync(new URL(`../fixtures/backups/${name}`, import.meta.url), 'utf8');

test('the current-format snapshot imports with its profile, events and saved song', () => {
  const file = JSON.parse(read('v2-snapshot.json'));
  const r = importProgress(read('v2-snapshot.json'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.db, file.db);
  assert.equal(r.db.sessions.length, 3);
  assert.equal(r.db.events.length, 2);
  assert.equal(r.db.mods.kbd.item.n60.m, 0.7);
  assert.equal(r.songs.length, 1);
  assert.equal(r.songs[0].title, 'My Little Tune');
  assert.deepEqual(r.songs, file.songs);
});

test('the current-format snapshot round-trips: export of what was imported is the same file', () => {
  const text = read('v2-snapshot.json');
  const file = JSON.parse(text);
  const r = importProgress(text);
  assert.equal(r.ok, true);
  const again = exportProgress(r.db, { appVersion: file.appVersion, now: () => Date.parse(file.exportedAt), songs: r.songs });
  assert.deepEqual(JSON.parse(JSON.stringify(again)), file);
});

test('the snapshot is stamped as the current envelope format', () => {
  const file = JSON.parse(read('v2-snapshot.json'));
  assert.equal(file.format, PROGRESS_FORMAT);
  assert.equal(file.formatVersion, 2);
  assert.equal(file.db.v, CURRENT_DB_VERSION);
});

test('a version-1 backup (no song list) migrates to the current shape and keeps the learner\'s progress', () => {
  const file = JSON.parse(read('v1-backup.json'));
  assert.equal(file.formatVersion, 1);
  assert.equal('songs' in file, false, 'a v1 file has no songs field');
  const r = importProgress(read('v1-backup.json'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.songs, [], 'v1 migrates to an empty song list');
  assert.equal(r.db.v, CURRENT_DB_VERSION);
  assert.deepEqual(r.db.mods, file.db.mods);
  assert.deepEqual(r.db.sessions, file.db.sessions);
  assert.deepEqual(r.db.custom, file.db.custom);
  assert.equal(r.db.mods.kbd.item.n60.m, 0.7);
  // The db inside it also comes out of migrate() unchanged: it was already current.
  assert.deepEqual(migrate(file.db), file.db);
});

test('a version-1 backup re-exports as a current-format file', () => {
  const file = JSON.parse(read('v1-backup.json'));
  const r = importProgress(read('v1-backup.json'));
  const out = exportProgress(r.db, { appVersion: 'x', now: () => 0, songs: r.songs });
  assert.equal(out.formatVersion, 2);
  assert.deepEqual(out.songs, []);
  assert.deepEqual(importProgress(JSON.stringify(out)).db, r.db);
  assert.deepEqual(r.db.mods, file.db.mods);
});

test('a truncated file is refused in plain words and returns nothing usable', () => {
  const text = read('truncated.json');
  assert.throws(() => JSON.parse(text), 'the fixture really is broken JSON');
  const r = importProgress(text);
  assert.equal(r.ok, false);
  assert.match(r.error, /does not look like a Band Coach backup/i);
  assert.equal('db' in r, false);
  assert.equal('songs' in r, false);
});

test('a backup from a newer format (version 3) is refused with an update message and returns nothing usable', () => {
  const text = read('future-v3.json');
  assert.equal(JSON.parse(text).formatVersion, 3);
  const r = importProgress(text);
  assert.equal(r.ok, false);
  assert.match(r.error, /newer Band Coach/i);
  assert.match(r.error, /Update the app/i);
  assert.equal('db' in r, false);
  assert.equal('songs' in r, false);
});
