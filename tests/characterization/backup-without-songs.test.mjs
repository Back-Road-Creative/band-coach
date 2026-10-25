// Save a backup reads the saved song library first. Where that store cannot be
// opened (IndexedDB blocked or broken), the progress backup must still be
// downloaded, and the learner told that their songs are not in it -- never a
// silent click that saves nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Records each download's name and blob text instead of saving a file.
const CAPTURE = `(() => {
  window.__downloads = []; const blobs = new Map(); const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () { const b = blobs.get(this.href); if (this.download && b) b.text().then((text) => window.__downloads.push({ name: this.download, text })); };
})();`;
const BREAK_IDB = `indexedDB.open = function () { const req = {}; setTimeout(() => { req.error = new Error('blocked'); if (req.onerror) req.onerror(); }, 0); return req; };`;
const SEED = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));";

test('a song store that cannot be opened still saves the progress backup, and says the songs are missing', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED + CAPTURE + BREAK_IDB });
  t.after(() => page.close());
  await page.evaluate("document.getElementById('backupSaveBtn').click()");
  await page.waitFor('window.__downloads.length > 0');
  const [file] = await page.evaluate('window.__downloads');
  assert.equal(file.name, 'band-coach-progress.json');
  assert.ok(JSON.parse(file.text).db, 'the progress is in the file');
  await page.waitFor("/songs/i.test(document.getElementById('coach').textContent)");
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /not included/i);
});

test('with a working song store the usual saved message is shown', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED + CAPTURE });
  t.after(() => page.close());
  await page.evaluate("document.getElementById('backupSaveBtn').click()");
  await page.waitFor('window.__downloads.length > 0');
  await page.waitFor("/Backup saved/.test(document.getElementById('coach').textContent)");
  assert.doesNotMatch(await page.evaluate("document.getElementById('coach').textContent"), /not included/i);
});
