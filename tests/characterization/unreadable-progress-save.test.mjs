// When saved progress cannot be read at start-up, safeGet keeps the raw text
// under bandcoach.v1.corrupt. The notice offers a button that downloads that
// text byte for byte; the ordinary backup reminder never shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const CAPTURE = `(() => {
  window.__downloads = []; const blobs = new Map(); const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () { const b = blobs.get(this.href); if (this.download && b) b.text().then((text) => window.__downloads.push({ name: this.download, text })); };
})();`;
const RAW = '{"mods":';
const SEED_BAD = `localStorage.setItem('bandcoach.v1', ${JSON.stringify(RAW)});`;
const SEED_OK = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));";
const btn = "(() => { const b = document.getElementById('backupNudgeSaveCopy'); return { exists: !!b, hidden: !b || b.hidden, text: b ? b.textContent : '' }; })()";

test('an unreadable record offers a button that downloads the kept text exactly', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED_BAD + CAPTURE });
  t.after(() => page.close());
  const got = await page.evaluate(btn);
  assert.equal(got.hidden, false, 'the save button shows with the notice');
  assert.equal(got.text, 'Save the unreadable copy');
  await page.evaluate("document.getElementById('backupNudgeSaveCopy').click()");
  await page.waitFor('window.__downloads.length > 0');
  const [file] = await page.evaluate('window.__downloads');
  assert.equal(file.name, 'band-coach-unreadable-progress.txt');
  assert.equal(file.text, RAW);
  await page.waitFor("/unreadable copy/i.test(document.getElementById('coach').textContent)");
});

test('the ordinary backup reminder has no save-the-copy button', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED_OK });
  t.after(() => page.close());
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.evaluate('window.__coach.sess().judged = 8');
  await page.clickSelector('#endBtn');
  assert.equal(await page.evaluate("document.getElementById('backupNudge').hidden"), false);
  assert.equal((await page.evaluate(btn)).hidden, true);
});

test('the button is not shown when the kept copy is missing', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED_BAD + "const _g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return k === 'bandcoach.v1.corrupt' ? null : _g.call(this, k); };" });
  t.after(() => page.close());
  assert.equal((await page.evaluate("document.getElementById('backupNudge').hidden")), false);
  assert.equal((await page.evaluate(btn)).hidden, true);
});

test('the button label follows the Spanish locale', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED_BAD });
  t.after(() => page.close());
  await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal((await page.evaluate(btn)).text, 'Guardar la copia ilegible');
});
