// Restoring a backup replaces the learner's progress. The confirm names the
// day the backup was made (an old file picked by mistake is easy to spot),
// and once it is done the settings screen offers Undo, which puts back the
// progress as it was just before. Songs the backup added stay in the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const WHEN = '2026-03-14T12:00:00.000Z';
const captureConfirm = 'window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return true; };';
const undoBar = "(() => { const n = document.getElementById('restoreUndo'); return { hidden: n.hidden, text: n.textContent }; })()";

function backupFile(t, prefs, exportedAt = WHEN) {
  const dir = mkdtempSync(join(tmpdir(), 'bc-restore-undo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'band-coach-progress.json');
  writeFileSync(file, JSON.stringify({
    format: 'band-coach-progress', formatVersion: 2, appVersion: 'test', exportedAt,
    db: { v: 1, prefs: Object.assign({ mod: 'kbd', theme: 'light' }, prefs), mods: {}, sessions: [], events: [] },
    songs: [],
  }));
  return file;
}

async function openSettings(page) {
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
}

test('the restore question names the day the backup was made', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: captureConfirm + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await openSettings(page);
  await page.setFileInput('#backupRestoreInput', backupFile(t, {}));
  await page.waitFor('window.__asked.length === 1');
  const asked = await page.evaluate('window.__asked[0]');
  assert.match(asked, /March 14, 2026/, `got: ${JSON.stringify(asked)}`);
  assert.match(asked, /replace your current progress/);
});

test('the restore question is in Spanish, date included, when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: captureConfirm + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd', locale: 'es' } }));" });
  t.after(() => page.close());
  await openSettings(page);
  await page.setFileInput('#backupRestoreInput', backupFile(t, { locale: 'es' }));
  await page.waitFor('window.__asked.length === 1');
  assert.match(await page.evaluate('window.__asked[0]'), /14 de marzo de 2026/);
});

test('a backup with no readable date still asks, without a date', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: captureConfirm + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await openSettings(page);
  await page.setFileInput('#backupRestoreInput', backupFile(t, {}, 'not a date'));
  await page.waitFor('window.__asked.length === 1');
  assert.equal(await page.evaluate('window.__asked[0]'), 'Restore this backup? It will replace your current progress.');
});

test('Undo after a restore puts the progress back as it was', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: captureConfirm + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd', theme: 'dark' } }));" });
  t.after(() => page.close());
  assert.equal((await page.evaluate(undoBar)).hidden, true, 'no Undo before any restore');
  await openSettings(page);
  await page.setFileInput('#backupRestoreInput', backupFile(t, { theme: 'light' }));
  await page.waitFor("window.__coach.db().prefs.theme === 'light'");
  await page.waitFor("!document.getElementById('restoreUndo').hidden");
  assert.match((await page.evaluate(undoBar)).text, /Undo/);
  await page.clickSelector('#restoreUndoBtn');
  assert.equal(await page.evaluate('window.__coach.db().prefs.theme'), 'dark');
  assert.equal(JSON.parse(await page.evaluate("localStorage.getItem('bandcoach.v1')")).prefs.theme, 'dark', 'the undone profile is the one saved');
  assert.equal((await page.evaluate(undoBar)).hidden, true, 'Undo is spent once used');
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});
