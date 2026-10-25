// The hosted copy's service worker takes over a new version as soon as it is
// installed, but the open page keeps running the old code until it reloads.
// The page says so, in the learner's language, with a Reload button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// file:// pages have no service worker, so stand one in before boot.
const fakeSw = (controller) =>
  "(() => { const ls = []; const sw = { controller: " + controller + ", addEventListener: (type, fn) => { if (type === 'controllerchange') ls.push(fn); }, register: () => Promise.resolve() };" +
  " Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => sw }); window.__swChange = () => ls.forEach((fn) => fn()); })();";
const notice = "(() => { const n = document.getElementById('updateReady'); return { hidden: n.hidden, text: n.textContent }; })()";

test('a new version taking over shows the reload notice', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeSw('{}') + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  assert.equal((await page.evaluate(notice)).hidden, true, 'nothing shows before an update');
  await page.evaluate('window.__swChange()');
  const got = await page.evaluate(notice);
  assert.equal(got.hidden, false);
  assert.match(got.text, /new version/i, `got: ${JSON.stringify(got.text)}`);
  assert.match(got.text, /Reload/);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('the reload notice is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeSw('{}') + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'es', mod: 'kbd' } }));" });
  t.after(() => page.close());
  await page.evaluate('window.__swChange()');
  assert.match((await page.evaluate(notice)).text, /nueva versi/i);
});

test('the first install is not announced as an update', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeSw('null') + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await page.evaluate('window.__swChange()');
  assert.equal((await page.evaluate(notice)).hidden, true);
});

test('a hand-over during a session waits for the session to end', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakeSw('{}') + "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.evaluate('window.__swChange()');
  assert.equal((await page.evaluate(notice)).hidden, true, 'never mid-session');
  await page.clickSelector('#endBtn');
  assert.equal((await page.evaluate(notice)).hidden, false, 'shown once the session ends');
});
