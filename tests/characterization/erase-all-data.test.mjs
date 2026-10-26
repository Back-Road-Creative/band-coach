// Settings > "Erase all my data": asks first, says it cannot be undone, then
// removes every app key (the kept unreadable copy included) and the app's
// databases, leaves other sites' data alone, and reloads. Cancel changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// Seeds once: the init script runs again after the erase reloads the page. The guard is window.name, not
// localStorage, because a reload under load can show the new document an empty localStorage (the same
// race tune-first-offer.test.mjs waits out) and a localStorage guard would then seed everything again.
const SEED = (answer) => `(() => {
  window.confirm = (m) => { window.name = m; return ${answer}; };
  if (window.name) return; window.name = 'seeded';
  localStorage.setItem('bandcoach.v1', '{"mods":'); localStorage.setItem('bandcoach.v1.tuneAsked', '["gtr"]'); localStorage.setItem('bandcoach.v1.backupAt', '5'); localStorage.setItem('unrelated.site.key', 'keep');
  const q = indexedDB.open('bandcoach-songs', 1); q.onupgradeneeded = (e) => e.target.result.createObjectStore('x'); q.onsuccess = () => q.result.close();
})();`;
const keys = "JSON.stringify(Object.keys(localStorage).sort())";
const dbs = "indexedDB.databases().then((l) => l.map((d) => d.name))";
const press = "document.getElementById('eraseAllBtn').click()";

test('confirming erases every app key and database, keeps unrelated keys, and reloads', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED('true') });
  t.after(() => page.close());
  assert.ok((await page.evaluate(keys)).includes('bandcoach.v1.corrupt'), 'the kept unreadable copy exists before');
  assert.ok((await page.evaluate(dbs)).includes('bandcoach-songs'));
  // The keys go synchronously inside the click, so they are read in the same document, before the reload.
  const { left, asked } = JSON.parse(await page.evaluate(`(() => { ${press}; return JSON.stringify({ left: Object.keys(localStorage).sort(), asked: window.name }); })()`));
  assert.deepEqual(left.filter((k) => k.indexOf('bandcoach') === 0), [], 'no app key is left');
  assert.ok(left.includes('unrelated.site.key'));
  await page.waitFor("indexedDB.databases().then((l) => !l.some((d) => d.name === 'bandcoach-songs')).then((v) => { window.__gone = v; return v; }) && window.__gone === true");
  assert.match(asked, /cannot be undone/);
  assert.match(asked, /Save a backup/);
});

// A database deleted while a connection stays open is only "blocked": the app's own connections must let go when asked, or erase waits on itself.
const deleteDb = (name) => `new Promise((r) => { const q = indexedDB.deleteDatabase('${name}'); q.onsuccess = () => r('deleted'); q.onblocked = () => r('blocked'); q.onerror = () => r('error'); })`;
test("the app's own open databases close when a delete asks, so erase never waits on itself", async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('songs')"); // lists the saved songs, which opens (and so creates) the song database
  await page.waitFor("indexedDB.databases().then((l) => { window.__dbs = l.map((d) => d.name); }) && window.__dbs && window.__dbs.includes('bandcoach-songs') && window.__dbs.includes('band-coach-model-packs')");
  assert.equal(await page.evaluate(deleteDb('bandcoach-songs')), 'deleted');
  assert.equal(await page.evaluate(deleteDb('band-coach-model-packs')), 'deleted');
});

test('a database another tab keeps open is reported as not erased, and the page does not reload', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED('true') });
  t.after(() => page.close());
  await page.evaluate("window.__marker = 1; window.__held = indexedDB.open('bandcoach-songs', 1)");
  await page.evaluate(press);
  await page.waitFor("document.body.textContent.includes('could not be erased')");
  assert.equal(await page.evaluate("window.__marker"), 1, 'no reload after a partial erase');
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
