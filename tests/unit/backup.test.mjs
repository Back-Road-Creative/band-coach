// Backup save/restore decisions (no DOM): size gate, message choice, restore ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBackup, backupSaveOutcome, restoreBackup } from '../../src/core/backup.js';

const en = { 'backup.err.songsNotStored': 'songs not stored', 'backup.err.notSaved': 'not saved' };

test('a backup over the limit is not counted as made and says so', () => {
  assert.deepEqual(backupSaveOutcome({}, 101, 100), { counted: false, messageId: 'backup.savedTooLarge' });
  assert.deepEqual(backupSaveOutcome({}, 100, 100), { counted: true, messageId: 'backup.saved' });
});

test('a backup made without songs is counted but says the songs are missing', () => {
  assert.deepEqual(backupSaveOutcome(Object.defineProperty({}, 'songsMissing', { value: true }), 1, 100), { counted: true, messageId: 'backup.savedNoSongs' });
  assert.equal(backupSaveOutcome(Object.defineProperty({}, 'songsMissing', { value: true }), 101, 100).messageId, 'backup.savedTooLarge');
});

test('exportBackup flags a broken song store but still exports the progress', async () => {
  const seen = [];
  const exportProgressFile = (db, o) => { seen.push(o); return { db }; };
  const ok = await exportBackup({ library: () => ({ exportAll: async () => [{ id: 1 }] }), exportProgressFile, db: 'D', appVersion: 'v', now: 5 });
  assert.equal(ok.songsMissing, undefined); assert.deepEqual(seen[0], { appVersion: 'v', now: 5, songs: [{ id: 1 }] });
  const bad = await exportBackup({ library: () => { throw new Error('x'); }, exportProgressFile, db: 'D', appVersion: 'v', now: 5 });
  assert.equal(bad.songsMissing, true); assert.deepEqual(seen[1].songs, []); assert.equal(Object.keys(bad).includes('songsMissing'), false);
});

function deps(over = {}) {
  const log = [];
  return { log, d: { en, importProgressFile: t => ({ ok: true, db: t, songs: [{}] }),
    library: () => ({ importAll: async () => { log.push('songs'); return { failed: 0 }; } }),
    snapshot: () => { log.push('snapshot'); return 'BEFORE'; }, applyProfile: db => log.push('apply:' + db), writeDB: () => { log.push('write'); return true; }, ...over } };
}

test('restore puts the songs in first, then the profile, and hands back Undo', async () => {
  const { d, log } = deps();
  const r = await restoreBackup('PROFILE', d);
  assert.deepEqual(log, ['songs', 'snapshot', 'apply:PROFILE', 'write']);
  assert.deepEqual(r.say, { id: 'backup.restored' }); assert.equal(r.undo, 'BEFORE'); assert.equal(r.ret.ok, true);
});

test('a songs-store failure aborts before the profile is touched', async () => {
  const { d, log } = deps({ library: () => ({ importAll: async () => { throw new Error('idb'); } }) });
  const r = await restoreBackup('P', d);
  assert.deepEqual(log, []); assert.deepEqual(r.ret, { ok: false, error: 'songs not stored' });
  assert.equal(r.say.id, 'backup.err.songsNotStored'); assert.equal(r.undo, null);
});

test('songs that failed individually are counted in the message', async () => {
  const { d } = deps({ library: () => ({ importAll: async () => ({ failed: 3 }) }) });
  const r = await restoreBackup('P', d);
  assert.deepEqual(r.say, { id: 'backup.restoredSongsFailed', params: { count: 3 } }); assert.equal(r.ret.ok, true);
});

test('a profile that cannot be written reports not saved and offers no Undo', async () => {
  const { d } = deps({ writeDB: () => false });
  const r = await restoreBackup('P', d);
  assert.deepEqual(r.ret, { ok: false, error: 'not saved' }); assert.equal(r.say.id, 'backup.err.notSaved'); assert.equal(r.undo, null);
});

test('an unreadable file says its error and changes nothing; a pre-checked result is not re-parsed', async () => {
  const { d, log } = deps({ importProgressFile: () => ({ ok: false, errorId: 'backup.err.x' }) });
  const bad = await restoreBackup('junk', d);
  assert.deepEqual(bad.say, { id: 'backup.err.x' }); assert.deepEqual(log, []);
  const { d: d2, log: log2 } = deps({ importProgressFile: () => { throw new Error('parsed twice'); } });
  const r = await restoreBackup({ ok: true, db: 'Z' }, d2);
  assert.deepEqual(log2, ['snapshot', 'apply:Z', 'write']); assert.equal(r.ret.ok, true);
});
