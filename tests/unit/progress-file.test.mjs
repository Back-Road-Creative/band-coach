import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportProgress,
  importProgress,
  migrate,
  PROGRESS_FORMAT,
  PROGRESS_FORMAT_VERSION,
  CURRENT_DB_VERSION,
  MAX_IMPORT_BYTES,
} from '../../src/core/progress-file.js';

const sampleDB = () => ({
  v: 1,
  mods: { kbd: { level: 3, ready: 0.4, item: { n60: { m: 0.7, n: 4, last: 1000, seen: 12 } }, trans: {}, conf: {}, gain: 0.05, gate: 0.6, offset: 0, acc: {}, cr: {}, tick: 40, judged: 12, promo: { at: -999, level: 0 }, fast: 0 } },
  sessions: [{ d: '2026-09-01', mod: 'kbd', min: 12, acc: 0.8, a1: 0.7, a2: 0.9, from: 1, to: 3, breaks: 0 }],
  prefs: { mod: 'kbd', wind: 'bb', voice: 'low', names: true },
  custom: [60, 62, 64],
});

test('export produces the documented envelope shape', () => {
  const env = exportProgress(sampleDB(), { appVersion: '1.2.3', now: () => 1_700_000_000_000 });
  assert.equal(env.format, PROGRESS_FORMAT);
  assert.equal(env.formatVersion, PROGRESS_FORMAT_VERSION);
  assert.equal(env.appVersion, '1.2.3');
  assert.equal(env.exportedAt, new Date(1_700_000_000_000).toISOString());
  assert.deepEqual(env.db, sampleDB());
});

test('export is deterministic given the same now', () => {
  const db = sampleDB();
  const a = JSON.stringify(exportProgress(db, { appVersion: '1.2.3', now: () => 42 }));
  const b = JSON.stringify(exportProgress(db, { appVersion: '1.2.3', now: () => 42 }));
  assert.equal(a, b);
});

test('round trip: export then import recovers the same db', () => {
  const db = sampleDB();
  const text = JSON.stringify(exportProgress(db, { appVersion: '1.2.3', now: () => 1 }));
  const result = importProgress(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.db, db);
});

test('rejects non-JSON text', () => {
  const result = importProgress('this is not json {{{');
  assert.equal(result.ok, false);
  assert.match(result.error, /does not look like/i);
});

test('rejects a file with the wrong format tag', () => {
  const text = JSON.stringify({ format: 'some-other-app', formatVersion: 1, db: {} });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /does not look like/i);
});

test('rejects a missing format tag entirely', () => {
  const text = JSON.stringify({ db: sampleDB() });
  const result = importProgress(text);
  assert.equal(result.ok, false);
});

test('rejects a formatVersion newer than this app understands', () => {
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION + 1, db: {} });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /newer Band Coach/i);
});

test('rejects oversize input', () => {
  const big = 'x'.repeat(MAX_IMPORT_BYTES + 10);
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: 1, db: { pad: big } });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /too large/i);
});

test('rejects non-string input without throwing', () => {
  const result = importProgress({ not: 'a string' });
  assert.equal(result.ok, false);
});

test('migration ladder: a fake pre-versioning shape is stamped to the current version', () => {
  const older = { mods: { kbd: { level: 1 } }, sessions: [], prefs: {} }; // no `v` field at all
  const migrated = migrate(older);
  assert.equal(migrated.v, CURRENT_DB_VERSION);
  assert.deepEqual(migrated.mods, older.mods);
});

test('migration ladder: a db already at the current version passes through unchanged', () => {
  const current = sampleDB();
  const migrated = migrate(current);
  assert.deepEqual(migrated, current);
});

test('migration ladder: a non-object db does not throw', () => {
  const migrated = migrate(null);
  assert.equal(migrated.v, CURRENT_DB_VERSION);
});

test('export carries the song library alongside the db', () => {
  const env = exportProgress(sampleDB(), { appVersion: '1.2.3', now: () => 1, songs: [{ id: 'song-1', title: 'A' }] });
  assert.deepEqual(env.songs, [{ id: 'song-1', title: 'A' }]);
});

test('export defaults songs to an empty array when none are given', () => {
  const env = exportProgress(sampleDB(), { appVersion: '1.2.3', now: () => 1 });
  assert.deepEqual(env.songs, []);
});

test('a v1 backup file (no songs field at all) still imports, with an empty song list', () => {
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: 1, appVersion: '1.0.0', exportedAt: 'x', db: sampleDB() });
  const result = importProgress(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.db, sampleDB());
  assert.deepEqual(result.songs, []);
});

test('round trip: export then import recovers the song library too', () => {
  const songs = [{ id: 'song-1', title: 'A' }, { id: 'song-2', title: 'B' }];
  const text = JSON.stringify(exportProgress(sampleDB(), { appVersion: '1.2.3', now: () => 1, songs }));
  const result = importProgress(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.songs, songs);
});

test('a non-array songs field is treated as no songs, never throws', () => {
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: sampleDB(), songs: 'not-an-array' });
  const result = importProgress(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.songs, []);
});

test('rejects a formatVersion this app has never known about (3)', () => {
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: 3, db: {} });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /newer Band Coach/i);
});

test('rejects a backup with no profile at all, instead of silently wiping progress', () => {
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x' });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /undefined|null|object|JSON|schema/i);
});

test('rejects a db field that is not an object', () => {
  for (const badDB of ['hello', [1, 2], null]) {
    const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: badDB });
    const result = importProgress(text);
    assert.equal(result.ok, false, `expected db ${JSON.stringify(badDB)} to be rejected`);
  }
});

test('rejects a db stamped with a version newer than this app understands', () => {
  const newerDB = { ...sampleDB(), v: CURRENT_DB_VERSION + 1 };
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: newerDB });
  const result = importProgress(text);
  assert.equal(result.ok, false);
  assert.match(result.error, /newer Band Coach/i);
});

test('rejects a songs array containing a broken entry', () => {
  for (const badSongs of [[sampleDB(), null], ['x']]) {
    const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: sampleDB(), songs: badSongs });
    const result = importProgress(text);
    assert.equal(result.ok, false, `expected songs ${JSON.stringify(badSongs)} to be rejected`);
  }
});

test('accepts an empty songs array and a songs array of plain object entries', () => {
  for (const okSongs of [[], [{}]]) {
    const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: sampleDB(), songs: okSongs });
    const result = importProgress(text);
    assert.equal(result.ok, true);
    assert.deepEqual(result.songs, okSongs);
  }
});

test('a pre-versioning db with no v field still imports through importProgress, stamped v: 1', () => {
  const older = { mods: { kbd: { level: 1 } }, sessions: [], prefs: {} }; // no `v` field at all
  const text = JSON.stringify({ format: PROGRESS_FORMAT, formatVersion: PROGRESS_FORMAT_VERSION, appVersion: 'x', exportedAt: 'x', db: older });
  const result = importProgress(text);
  assert.equal(result.ok, true);
  assert.equal(result.db.v, CURRENT_DB_VERSION);
  assert.deepEqual(result.db.mods, older.mods);
});
