// F16: the hosted copy offers an Install button when the browser allows it,
// and Settings says how old this copy is, read from the build date stamped
// into the page (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const profile = (prefs) => "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: " + JSON.stringify(prefs) + " }));";
const openSettings = (page) => page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
const line = (id) => "(() => { const n = document.getElementById('" + id + "'); return { hidden: n.hidden, text: n.textContent }; })()";
const offerInstall = "(() => { window.__prompted = 0; const ev = new Event('beforeinstallprompt', { cancelable: true }); ev.prompt = () => { window.__prompted++; return Promise.resolve(); }; ev.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(ev); return ev.defaultPrevented; })()";
// Stamps a build date the way a release build does, and moves the clock on.
const stamp = (built, days) => "(() => { document.querySelector('meta[name=\"band-coach-built\"]').content = '" + built + "'; const base = Date.parse('" + built + "T12:00:00Z') + " + days + " * 86400000; Date.now = () => base; })()";

test('no install offer from the browser means no Install button', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await openSettings(page);
  assert.equal((await page.evaluate(line('installBtn'))).hidden, true);
});

test('a synthetic install offer shows the Install button, and pressing it opens the browser prompt once', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  assert.equal(await page.evaluate(offerInstall), true, 'the browser banner is held back');
  await openSettings(page);
  const got = await page.evaluate(line('installBtn'));
  assert.equal(got.hidden, false);
  assert.match(got.text, /Install/);
  await page.clickSelector('#installBtn');
  await page.waitFor('window.__prompted === 1');
  await page.waitFor("document.getElementById('installBtn').hidden");
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('the Install button appearing does not move any other control in Settings', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  const tops = "Array.from(document.querySelectorAll('#settingsView button, #settingsView select, #settingsView input, #settingsView label')).filter((n) => n.id !== 'installBtn').map((n) => (n.id || n.htmlFor || n.textContent.trim()) + ' ' + n.getBoundingClientRect().top)";
  await openSettings(page);
  const before = await page.evaluate(tops);
  await page.evaluate(offerInstall);
  assert.equal((await page.evaluate(line('installBtn'))).hidden, false);
  assert.deepEqual(await page.evaluate(tops), before);
});

test('a dev build has no build date, so Settings shows no age line', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await openSettings(page);
  assert.equal((await page.evaluate(line('copyAge'))).hidden, true);
});

test('with the clock 200 days past the build date, Settings says the copy is 200 days old', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await page.evaluate(stamp('2026-01-10', 200));
  await openSettings(page);
  const got = await page.evaluate(line('copyAge'));
  assert.equal(got.hidden, false);
  assert.match(got.text, /200 days old/, `got: ${JSON.stringify(got.text)}`);
});

test('the age line is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd', locale: 'es' }) });
  t.after(() => page.close());
  await page.evaluate(stamp('2026-01-10', 200));
  await openSettings(page);
  assert.match((await page.evaluate(line('copyAge'))).text, /200 días/);
});

test('a copy built today says so rather than "0 days old"', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await page.evaluate(stamp('2026-01-10', 0));
  await openSettings(page);
  assert.match((await page.evaluate(line('copyAge'))).text, /built today/);
});
