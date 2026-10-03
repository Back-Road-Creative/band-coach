// Acceptance scenario A09: a learner's backup is the only copy of their
// progress that outlives the browser's storage, so it has to survive the real
// route: Save a backup with a click (a real download), Restore a backup through
// the real file chooser, answer the real confirm(). These run the release file
// a person downloads, driving it with clicks and file picks only; page.evaluate
// reads text, attributes and storage and never acts.
//
// The backups used for the refusal cases below are derived at test time from
// the file the app itself saved, never from app code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WAIT_FLOOR_MS, acceptanceHtmlPath, withAcceptancePage } from '../helpers/browser.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';
import { captureDownloads, fillLocalStorage, localStorageItem, setLocalStorageItem } from '../helpers/cdp-extras.mjs';
import { t as say } from '../../src/core/i18n.js';

const TUNE = fileURLToPath(new URL('../fixtures/acceptance/backup-restore/tune.abc', import.meta.url));
const KEY = 'bandcoach.v1';
const BACKUP_NAME = 'band-coach-progress.json';
const RESTORED = 'Backup restored.';
const CONFIRM = { type: 'confirm', message: 'Restore this backup? It will replace your current progress.' };
const RESET_CONFIRM = { type: 'confirm', message: say('reset.confirm', { name: 'Keyboard' }) };
const NOT_A_BACKUP = 'That does not look like a Band Coach backup file.';
const TOO_NEW = 'This backup was made by a newer Band Coach. Update the app to restore it.';
const NO_PROGRESS = 'That backup file has no saved progress in it, so nothing was changed.';
const DAMAGED_SONG = 'That backup file has a damaged song in it, so nothing was changed.';
const NOT_SAVED = 'Your restored progress could not be saved on this device (storage may be full).';

function scratchDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Wall time per test, reported with t.diagnostic (the file has a 90 s budget).
async function timed(t, fn) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    t.diagnostic(`wall time ${((Date.now() - start) / 1000).toFixed(1)} s`);
  }
}

const textOf = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const says = async (page) => ({ coach: await textOf(page, 'coach'), settingsSay: await textOf(page, 'settingsSay'), mainSay: await textOf(page, 'mainSay') });
const go = (page, route) => page.clickSelector(`#mainNav button[data-route="${route}"]`);
const chooseKeyboard = (page) => page.clickSelector('#picker button[data-mod="kbd"]');
const level = async (page) => { await go(page, 'practice'); return textOf(page, 'levelNum'); };

async function skipAhead(page, times) {
  await go(page, 'practice');
  for (let i = 0; i < times; i++) await page.clickSelector('#harderBtn');
}
// The save is debounced (1200 ms), so wait for storage to say so.
const waitStoredLevel = (page, n) =>
  page.waitFor(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).mods.kbd.level === ${n}; } catch (e) { return false; } })()`);
const storedRaw = (page) => page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);

// The list draws the starter tunes first and the saved songs a moment later, so a caller expecting a saved title waits for it.
async function songTitles(page, { waitFor } = {}) {
  await go(page, 'songs');
  await page.waitFor("document.querySelector('.panel-songs-row')");
  if (waitFor) await page.waitFor(`Array.from(document.querySelectorAll('.panel-songs-row button')).some((b) => b.textContent.trim() === ${JSON.stringify(waitFor)})`);
  return page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).map((b) => b.textContent.trim())");
}

// Save a backup with a click, into a folder of its own, and read what landed.
async function saveBackup(t, page) {
  const waitForDownload = await captureDownloads(page, mkdtempSync(join(scratchDir(t), 'save-')));
  await go(page, 'settings');
  await page.clickSelector('#backupSaveBtn');
  return waitForDownload(BACKUP_NAME);
}
// Click Reset this instrument and answer the confirm() it raises ('accept' or 'dismiss'); returns the dialogs seen.
async function clickReset(page, answer) {
  const dialogs = [];
  const off = page.cdp.on((msg) => {
    if (msg.method !== 'Page.javascriptDialogOpening') return;
    dialogs.push({ type: msg.params.type, message: msg.params.message });
    page.cdp.send('Page.handleJavaScriptDialog', { accept: answer === 'accept' }).catch(() => {});
  });
  try { await page.clickSelector('#resetBtn'); await page.evaluate('0'); } finally { off(); }
  return dialogs;
}
const restore = (page, file, dialog) => chooseFile(page, 'label[for="backupRestoreInput"]', file, { dialog });
// The restore's verdict is the first moment #coach reads "Backup restored." or the not-saved text; the three
// status lines are read in that same instant. A failed write also queues a retry 1.2 s later that rewrites
// #settingsSay and #mainSay, so reading them one call at a time would race it.
const restoreVerdict = (page) => page.evaluate(`new Promise((resolve, reject) => {
  const read = (id) => document.getElementById(id).textContent.trim();
  const give_up = Date.now() + ${WAIT_FLOOR_MS};
  const timer = setInterval(() => {
    const coach = read('coach');
    if (coach === ${JSON.stringify(RESTORED)} || coach === ${JSON.stringify(NOT_SAVED)}) { clearInterval(timer); resolve({ coach, settingsSay: read('settingsSay'), mainSay: read('mainSay') }); }
    else if (Date.now() > give_up) { clearInterval(timer); reject(new Error('#coach never gave a restore verdict; it reads: ' + coach)); }
  }, 5);
})`);
const waitSettingsSay = (page, message) =>
  page.waitFor(`document.getElementById('settingsSay').textContent.trim() === ${JSON.stringify(message)}`);

// A fresh page on the keyboard, a Level 3 backup saved, then Level 5 stored:
// the starting point for the restore tests that change or refuse a restore.
async function level3BackupThenLevel5(t, page) {
  await chooseKeyboard(page);
  await skipAhead(page, 2);
  assert.equal(await textOf(page, 'levelNum'), 'Level 3');
  const saved = await saveBackup(t, page);
  await skipAhead(page, 2);
  assert.equal(await textOf(page, 'levelNum'), 'Level 5');
  await waitStoredLevel(page, 5);
  return saved;
}

test('A09 T1: save a backup, move on, restore it through the file chooser: the saved progress and song are back, and stay after a reload', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    await chooseKeyboard(page);
    await skipAhead(page, 2);
    assert.equal(await textOf(page, 'levelNum'), 'Level 3');

    // Add a song from a real file; the review shows it with no further click.
    await go(page, 'songs');
    await page.waitFor("document.querySelector('.add-song-row')");
    await page.clickSelector('.add-song-row button');
    // The input itself is clicked: its label wraps over two lines and the middle of its box is the gap between them.
    const added = await chooseFile(page, '#songsFileInput', TUNE);
    assert.deepEqual(added.dialogs, [], 'adding a song raises no dialog');
    await page.waitFor("document.querySelector('.panel-learn-result') && document.querySelector('.panel-learn-result').hidden === false");
    assert.equal(await page.evaluate("document.querySelector('.panel-learn-result h4').textContent"), 'Backup Test Tune');

    const saved = await saveBackup(t, page);
    const file = JSON.parse(saved.text);
    assert.equal(file.format, 'band-coach-progress');
    assert.equal(file.formatVersion, 2);
    assert.equal(file.db.mods.kbd.level, 3);
    assert.ok(file.songs.some((s) => s.title === 'Backup Test Tune'), `the backup carries the song: ${JSON.stringify(file.songs.map((s) => s.title))}`);
    assert.equal(await textOf(page, 'coach'), say('backup.saved'));

    await skipAhead(page, 2);
    assert.equal(await textOf(page, 'levelNum'), 'Level 5');
    await waitStoredLevel(page, 5);

    await go(page, 'settings');
    const picked = await restore(page, saved.path, 'accept');
    assert.deepEqual(picked.dialogs, [CONFIRM]);
    await waitSettingsSay(page, RESTORED);
    assert.equal(await textOf(page, 'coach'), RESTORED);
    assert.equal(await level(page), 'Level 3');
    assert.equal(JSON.parse(await storedRaw(page)).mods.kbd.level, 3);

    const titles = await songTitles(page, { waitFor: 'Backup Test Tune' });
    const copies = titles.filter((x) => x === 'Backup Test Tune').length;
    t.diagnostic(`rows titled "Backup Test Tune" after restoring on the same device: ${copies}`);
    assert.ok(copies >= 1, `the saved song is still listed: ${JSON.stringify(titles)}`);

    await page.reload();
    assert.equal(await level(page), 'Level 3', 'the restore survives a reload');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  }));
});

test('A09 T2: declining the confirm changes nothing; picking the same file again and accepting restores it', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    const saved = await level3BackupThenLevel5(t, page);
    const before = await storedRaw(page);

    await go(page, 'settings');
    const declined = await restore(page, saved.path, 'dismiss');
    assert.deepEqual(declined.dialogs, [CONFIRM], 'the one restore confirm was raised');
    assert.equal(await storedRaw(page), before, 'storage is byte-for-byte as it was');
    assert.equal(await level(page), 'Level 5');
    await go(page, 'settings');
    const after = await says(page);
    for (const [where, text] of Object.entries(after)) assert.notEqual(text, RESTORED, `${where} does not claim a restore`);

    // Negative control: the same file again, accepted, restores. The page
    // cleared the input after the first pick, so this fires a change again.
    const again = await restore(page, saved.path, 'accept');
    assert.deepEqual(again.dialogs, [CONFIRM]);
    await waitSettingsSay(page, RESTORED);
    assert.equal(await level(page), 'Level 3');
  }));
});

test('A09 T3: six bad backup files each say what is wrong and leave progress and songs as they were; the real file then restores', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    const saved = await level3BackupThenLevel5(t, page);
    const dir = scratchDir(t);
    const real = readFileSync(saved.path);
    const variant = (edit) => { const env = JSON.parse(real.toString('utf8')); edit(env); return JSON.stringify(env); };
    const cases = {
      1: { label: 'truncated', body: real.subarray(0, Math.floor(real.length / 2)), message: NOT_A_BACKUP },
      2: { label: 'JSON that is not a backup', body: '{"hello":1}', message: NOT_A_BACKUP },
      3: { label: 'formatVersion 3', body: variant((e) => { e.formatVersion = 3; }), message: TOO_NEW },
      4: { label: 'db.v 2', body: variant((e) => { e.db.v = 2; }), message: TOO_NEW },
      5: { label: 'db null', body: variant((e) => { e.db = null; }), message: NO_PROGRESS },
      6: { label: 'songs [1]', body: variant((e) => { e.songs = [1]; }), message: DAMAGED_SONG },
    };
    const storedBefore = await storedRaw(page);
    const levelBefore = await level(page);
    const titlesBefore = await songTitles(page);
    assert.equal(levelBefore, 'Level 5');

    // Neighbouring picks never expect the same text, so a stale message cannot pass for a fresh one.
    for (const n of [1, 3, 2, 5, 4, 6]) {
      const { label, body, message } = cases[n];
      const path = join(dir, `bad-${n}.json`);
      writeFileSync(path, body);
      await go(page, 'settings');
      const picked = await restore(page, path, 'accept');
      assert.deepEqual(picked.dialogs, [CONFIRM], `${label}: the confirm was raised, so the change event fired`);
      await waitSettingsSay(page, message);
      const now = await says(page);
      assert.equal(now.settingsSay, message, `${label}: #settingsSay`);
      assert.equal(now.coach, message, `${label}: #coach`);
      for (const [where, text] of Object.entries(now)) assert.notEqual(text, RESTORED, `${label}: ${where} claims a restore`);
      assert.equal(await storedRaw(page), storedBefore, `${label}: storage is unchanged`);
      assert.equal(await level(page), levelBefore, `${label}: level is unchanged`);
      assert.deepEqual(await songTitles(page), titlesBefore, `${label}: songs are unchanged`);
    }

    // Negative control: the real file restores, so the refusals were about the files.
    await go(page, 'settings');
    const good = await restore(page, saved.path, 'accept');
    assert.deepEqual(good.dialogs, [CONFIRM]);
    await waitSettingsSay(page, RESTORED);
    assert.equal(await level(page), 'Level 3');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  }));
});

test('A09 T4: a restore that cannot be saved says so instead of "Backup restored."', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    await chooseKeyboard(page);
    await skipAhead(page, 9);
    assert.equal(await textOf(page, 'levelNum'), 'Level 10');
    await waitStoredLevel(page, 10);
    const saved = await saveBackup(t, page);
    assert.deepEqual(await clickReset(page, 'accept'), [RESET_CONFIRM]);
    await waitStoredLevel(page, 1);
    const before = await storedRaw(page);
    t.diagnostic(`stored profile before the restore: ${before.length} characters; the Level 10 backup's profile: ${JSON.stringify(JSON.parse(saved.text).db).length} characters`);

    // No item may grow now, so the longer Level 10 profile cannot be written.
    const fill = await fillLocalStorage(page);
    t.diagnostic(`storage filled: ${JSON.stringify(fill)}`);

    const picked = await restore(page, saved.path, 'accept');
    assert.deepEqual(picked.dialogs, [CONFIRM]);
    const now = await restoreVerdict(page);
    // (a) The write really failed: the page's own save-failed line is up.
    assert.equal(now.mainSay, say('storage.saveFailed'), '#mainSay shows the save-failed line, so the write really failed');
    // (b) And the restore does not claim otherwise.
    assert.equal(now.settingsSay, NOT_SAVED, '#settingsSay');
    assert.equal(now.coach, NOT_SAVED, '#coach');
    for (const [where, text] of Object.entries(now)) assert.ok(!text.includes(RESTORED), `${where} must not say "${RESTORED}": ${text}`);
    assert.equal(await storedRaw(page), before, 'storage still holds the profile from before the restore');
  }));
});

test('A09 T5: a profile an older build saved at this path is upgraded (seeded from outside), and a formatVersion 1 backup restores', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    // Seeded, not learned: the pre-v1 profile shape (no "v"), written from outside the page.
    const old = '{"mods":{"kbd":{"level":4}},"prefs":{"mod":"kbd"}}';
    t.diagnostic(`seeded an old-build profile from outside the page: ${old}`);
    await setLocalStorageItem(page, KEY, old);
    await page.reload();
    assert.equal(await level(page), 'Level 4', 'the old profile is picked up with no restore');
    await page.clickSelector('#harderBtn');
    assert.equal(await textOf(page, 'levelNum'), 'Level 5');
    await waitStoredLevel(page, 5);
    const stored = JSON.parse(await storedRaw(page));
    assert.equal(stored.v, 1, 'the stored profile is the current version');
    assert.equal(stored.mods.kbd.level, 5);

    // Hand-written formatVersion 1 backup (no songs).
    const v1 = join(scratchDir(t), 'old-backup.json');
    writeFileSync(v1, '{"format":"band-coach-progress","formatVersion":1,"db":{"mods":{"kbd":{"level":7}}}}');
    t.diagnostic('hand-written formatVersion 1 backup: level 7, no songs');
    await go(page, 'settings');
    const picked = await restore(page, v1, 'accept');
    assert.deepEqual(picked.dialogs, [CONFIRM]);
    await waitSettingsSay(page, RESTORED);
    assert.equal(await level(page), 'Level 7');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  }));
});

test('A09 T6: the same build opened under another file name restores a backup made under the first', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    const saved = await level3BackupThenLevel5(t, page);

    const copy = join(scratchDir(t), 'band-coach-renamed.html');
    copyFileSync(acceptanceHtmlPath(), copy);
    const url = pathToFileURL(copy).href;
    await page.cdp.send('Page.navigate', { url });
    // The old document still carries data-coach-ready, so wait for the new URL too.
    const start = Date.now();
    for (;;) {
      const ready = await page.evaluate(`location.href === ${JSON.stringify(url)} && document.documentElement.getAttribute('data-coach-ready') === '1'`).catch(() => false);
      if (ready) break;
      if (Date.now() - start > WAIT_FLOOR_MS) throw new Error(`the renamed copy did not open at ${url}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    t.diagnostic(`under the other file name before any restore: ${await textOf(page, 'levelNum')}; stored profile present: ${(await localStorageItem(page, KEY)) !== null}`);

    await go(page, 'settings');
    const picked = await restore(page, saved.path, 'accept');
    assert.deepEqual(picked.dialogs, [CONFIRM]);
    await waitSettingsSay(page, RESTORED);
    assert.equal(await level(page), 'Level 3');
  }));
});

test('A09 T7: Reset this instrument asks first; declining keeps the progress, accepting clears it', async (t) => {
  await timed(t, () => withAcceptancePage(t, {}, async (page) => {
    await chooseKeyboard(page);
    await skipAhead(page, 4);
    await waitStoredLevel(page, 5);
    await go(page, 'settings');
    const before = await storedRaw(page);
    assert.deepEqual(await clickReset(page, 'dismiss'), [RESET_CONFIRM], 'the reset confirm was raised');
    assert.equal(await storedRaw(page), before, 'declining leaves storage byte-for-byte as it was');
    assert.ok(!(await textOf(page, 'settingsSay')).includes('cleared'), 'declining does not claim a reset');
    assert.equal(await level(page), 'Level 5');
    // Negative control: accepting the same confirm clears the instrument.
    await go(page, 'settings');
    assert.deepEqual(await clickReset(page, 'accept'), [RESET_CONFIRM]);
    await waitStoredLevel(page, 1);
    assert.equal(await level(page), 'Level 1');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
  }));
});
