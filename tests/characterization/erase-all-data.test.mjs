// Settings > "Erase all my data": asks first, says it cannot be undone, then
// removes every app key (the kept unreadable copy included) and the app's
// databases, leaves other sites' data alone, and reloads. Cancel changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Seeds once (the init script runs again after the erase reloads the page, and must not re-seed). The unrelated key doubles as the marker: erase keeps it.
const SEED = (answer) => `(() => {
  window.confirm = (m) => { window.name = m; return ${answer}; };
  if (localStorage.getItem('unrelated.site.key')) return;
  localStorage.setItem('bandcoach.v1', '{"mods":'); localStorage.setItem('bandcoach.v1.tuneAsked', '["gtr"]'); localStorage.setItem('bandcoach.v1.backupAt', '5'); localStorage.setItem('unrelated.site.key', 'keep');
  indexedDB.open('bandcoach-songs', 1).onupgradeneeded = (e) => e.target.result.createObjectStore('x');
})();`;
const keys = "JSON.stringify(Object.keys(localStorage).sort())";
const dbs = "indexedDB.databases().then((l) => l.map((d) => d.name))";
const press = "document.getElementById('eraseAllBtn').click()";

test('confirming erases every app key and database, keeps unrelated keys, and reloads', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED('true') });
  t.after(() => page.close());
  assert.ok((await page.evaluate(keys)).includes('bandcoach.v1.corrupt'), 'the kept unreadable copy exists before');
  assert.ok((await page.evaluate(dbs)).includes('bandcoach-songs'));
  await page.evaluate(press);
  await page.waitFor("!Object.keys(localStorage).includes('bandcoach.v1.tuneAsked')");
  const left = JSON.parse(await page.evaluate(keys));
  assert.deepEqual(left.filter((k) => k.indexOf('bandcoach') === 0 && k !== 'bandcoach.v1'), [], 'no app key but the fresh profile the new page may write');
  assert.ok(left.includes('unrelated.site.key'));
  await page.waitFor("indexedDB.databases().then((l) => !l.some((d) => d.name === 'bandcoach-songs')).then((v) => { window.__gone = v; return v; }) && window.__gone === true");
  const asked = await page.evaluate("window.name");
  assert.match(asked, /cannot be undone/);
  assert.match(asked, /Save a backup/);
});

test('cancelling leaves everything exactly as it was', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED('false') });
  t.after(() => page.close());
  const before = await page.evaluate(keys);
  await page.evaluate(press);
  assert.equal(await page.evaluate(keys), before);
  assert.ok((await page.evaluate(dbs)).includes('bandcoach-songs'));
});

test('the button reads in Spanish', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED('false') });
  t.after(() => page.close());
  await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal(await page.evaluate("document.getElementById('eraseAllBtn').textContent"), 'Borrar todos mis datos');
});
