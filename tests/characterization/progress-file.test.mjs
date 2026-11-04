import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { MAX_IMPORT_BYTES } from '../../src/core/progress-file.js';
import { en } from '../../src/core/i18n.js';

const htmlPath = HTML_PATH;

test('a backup can be exported and restored into a fresh profile', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor(`window.__coach.db().mods.kbd.item['n' + ${midi}]`, 3000);

  const before = await page.evaluate(`window.__coach.db().mods.kbd.item['n' + ${midi}].m`);
  // exportProgress() is now async (it reads the song library too), so the
  // expression itself must be a promise for evaluate()'s awaitPromise to wait
  // on it -- JSON.stringify(exportProgress()) would stringify the Promise
  // object itself, not its resolved value.
  const backupText = await page.evaluate('(async () => JSON.stringify(await window.__coach.exportProgress()))()');

  const fresh = await launchPage(htmlPath);
  t.after(() => fresh.close());
  await fresh.evaluate("localStorage.clear()");
  await fresh.reload();
  await fresh.waitFor('typeof window.__coach !== "undefined"', 8000);

  const importResult = await fresh.evaluate(
    `window.__coach.importProgress(${JSON.stringify(backupText)})`
  );
  assert.equal(importResult.ok, true, 'import reports success on a real backup');

  const after = await fresh.evaluate(`window.__coach.db().mods.kbd.item['n' + ${midi}].m`);
  assert.equal(after, before, 'the answered item\'s mastery survived the round trip');
});

test('importing garbage leaves existing progress untouched and reports an error', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor(`window.__coach.db().mods.kbd.item['n' + ${midi}]`, 3000);

  const before = await page.evaluate('JSON.stringify(window.__coach.db())');

  const result = await page.evaluate("window.__coach.importProgress('not json at all {{{')");
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length, 'a plain-English error message is returned');

  const after = await page.evaluate('JSON.stringify(window.__coach.db())');
  assert.equal(after, before, 'a rejected import never mutates the existing db');
});

const SPY_BLOB = (fakeSize) => `window.__saved = []; const RealBlob = window.Blob;
  window.Blob = function (parts, options) {
    const blob = new RealBlob(parts, options);
    window.__saved.push(parts[0]);
    if (${fakeSize}) Object.defineProperty(blob, 'size', { value: ${fakeSize} });
    return blob;
  };`;

test('a saved backup has no pretty-print padding, so it is as small as it can be', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate(SPY_BLOB(0));
  await page.evaluate("document.getElementById('backupSaveBtn').click()");
  await page.waitFor('window.__saved.length === 1');
  assert.equal(await page.evaluate("window.__saved[0].includes('\\n')"), false);
  assert.equal(await page.evaluate("JSON.parse(window.__saved[0]).format"), 'band-coach-progress');
});

test('a backup too big to restore says so and does not count as a backup made', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate(SPY_BLOB(MAX_IMPORT_BYTES + 1));
  await page.evaluate("document.getElementById('backupSaveBtn').click()");
  await page.waitFor('window.__saved.length === 1');
  await page.waitFor(`document.getElementById('coach').textContent === ${JSON.stringify(en['backup.savedTooLarge'])}`);
  assert.equal(await page.evaluate("localStorage.getItem('bandcoach.v1.backupAt')"), null);
});

test('a restore keeps the progress and the good songs when one saved song is refused', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const good = { schema: 'song/1', id: 'kept', title: 'Kept', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480, chords: [], parts: [{ id: 'm', name: 'M', notes: [{ start: 0, dur: 480, midi: 60 }] }] };
  const tooLong = { ...good, id: 'too-long', title: 'Too long', parts: [{ id: 'm', name: 'M', notes: [{ start: 5001 * 1920, dur: 480, midi: 60 }] }] };
  const backup = JSON.parse(await page.evaluate('(async () => JSON.stringify(await window.__coach.exportProgress()))()'));
  backup.db.prefs.theme = 'dark';
  backup.songs = [tooLong, good];
  const result = await page.evaluate(`window.__coach.importProgress(${JSON.stringify(JSON.stringify(backup))})`);
  assert.equal(result.ok, true);
  assert.equal(await page.evaluate('window.__coach.db().prefs.theme'), 'dark', 'the progress was restored');
  assert.equal(await page.evaluate("document.getElementById('coach').textContent"), en['backup.restoredSongsFailed'].replace('{count}', '1'));
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent.includes('Kept'))");
});
