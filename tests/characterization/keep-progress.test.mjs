// F10: after the first logged session the app asks the browser to keep its
// data, and Settings says whether it is kept and about how much is stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const fakeStorage = (grant) =>
  "(() => { let kept = false; window.__persistCalls = 0; const sm = { persisted: async () => kept, persist: async () => { window.__persistCalls++; kept = " + grant + "; return kept; }, estimate: async () => ({ usage: 50000, quota: 1e9 }) };" +
  " Object.defineProperty(navigator, 'storage', { configurable: true, get: () => sm }); })();";
const profile = (prefs) => "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: " + JSON.stringify(prefs) + " }));";
const status = "(() => { const n = document.getElementById('keepStatus'); return { hidden: n.hidden, text: n.textContent }; })()";

async function loggedSession(page) {
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.evaluate('window.__coach.sess().judged = 8');
  await page.clickSelector('#endBtn');
}
async function openSettings(page) {
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
}

test('a logged session asks the browser to keep progress, and Settings says it is kept', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeStorage('true') + profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  assert.equal(await page.evaluate('window.__persistCalls'), 0, 'nothing is asked at start-up');
  await loggedSession(page);
  await page.waitFor('window.__persistCalls === 1');
  await openSettings(page);
  await page.waitFor("!document.getElementById('keepStatus').hidden");
  const got = await page.evaluate(status);
  assert.match(got.text, /keeps your progress/, `got: ${JSON.stringify(got.text)}`);
  assert.match(got.text, /49 KB/);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('a session too short to log asks nothing', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeStorage('true') + profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.clickSelector('#endBtn');
  assert.equal(await page.evaluate('window.__persistCalls'), 0);
});

test('when the browser will not keep it, Settings says so and points at a backup, in Spanish too', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeStorage('false') + profile({ mod: 'kbd', locale: 'es' }) });
  t.after(() => page.close());
  await openSettings(page);
  await page.waitFor("!document.getElementById('keepStatus').hidden");
  assert.match((await page.evaluate(status)).text, /copia de seguridad/);
});

test('a browser without the storage API shows no line', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "Object.defineProperty(navigator, 'storage', { configurable: true, get: () => undefined });" + profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await openSettings(page);
  assert.equal((await page.evaluate(status)).hidden, true);
});

// The line fills in after an async read, so it sits at the very end of
// Settings: appearing must not move any control someone (or a test) is about to click.
test('the kept-or-not line appearing does not move any control in Settings', async (t) => {
  const slow = "(() => { const later = (v) => new Promise((r) => setTimeout(() => r(v), 300)); const sm = { persisted: () => later(true), persist: () => later(true), estimate: () => later({ usage: 50000 }) };" +
    " Object.defineProperty(navigator, 'storage', { configurable: true, get: () => sm }); })();";
  const page = await launchPage(HTML_PATH, { initScript: slow + profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  const tops = "Array.from(document.querySelectorAll('#settingsView button, #settingsView select, #settingsView input, #settingsView label')).map((n) => (n.id || n.htmlFor || n.textContent.trim()) + ' ' + n.getBoundingClientRect().top)";
  await openSettings(page);
  assert.equal((await page.evaluate(status)).hidden, true, 'the line is still waiting on the browser');
  const before = await page.evaluate(tops);
  await page.waitFor("!document.getElementById('keepStatus').hidden");
  assert.deepEqual(await page.evaluate(tops), before);
});

// The line is filled once, when Settings opens, so switching the language from
// Settings itself must redo it (and the copy-age line) in the new language.
test('switching the language in Settings redoes the kept-or-not and copy-age lines in that language', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeStorage('false') + profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await openSettings(page);
  await page.waitFor("!document.getElementById('keepStatus').hidden");
  assert.match((await page.evaluate(status)).text, /Save a backup/);
  const age = "document.getElementById('copyAge').hidden ? null : document.getElementById('copyAge').textContent";
  const ageEn = await page.evaluate(age);
  await page.evaluate("(() => { const s = document.getElementById('optLocale'); s.value = 'es'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await page.waitFor("/copia de seguridad/.test(document.getElementById('keepStatus').textContent)").catch(() => {});
  assert.match((await page.evaluate(status)).text, /copia de seguridad/);
  if (ageEn !== null) assert.notEqual(await page.evaluate(age), ageEn, 'the copy-age line is redone in Spanish');
});
