// A throw that escapes frame()/onPitch (a rejected promise, a MIDI handler, an
// openMic chain) used to reach only the console: practice went quiet with no
// word to the learner and nothing for the maker. Now window 'error' and
// 'unhandledrejection' record into the error ring and show one dismissible,
// rate-limited notice; Settings has a Copy diagnostics button that never
// includes song titles, device ids, audio or file names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const SETTLE = 'new Promise(r => setTimeout(r, 300))';
const NOTICE_SHOWN = "(() => { const n = document.getElementById('errorNotice'); return !!n && !n.hidden; })()";

test('an unhandled promise rejection is recorded and the learner is told, with a way to dismiss it', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate(NOTICE_SHOWN), false, 'a clean boot shows no notice');
  await page.evaluate("setTimeout(() => { Promise.reject(new Error('rejected-on-purpose')); }, 0); " + SETTLE);

  assert.equal(await page.evaluate(NOTICE_SHOWN), true, 'the notice is visible');
  const text = await page.evaluate("document.getElementById('errorNotice').textContent");
  assert.match(text, /Something went wrong/, 'in plain words');
  assert.match(text, /Copy diagnostics/, 'and says where to report it');
  const errs = await page.evaluate('window.__coach.errors().map(e => e.message)');
  assert.ok(errs.includes('rejected-on-purpose'), 'the ring holds the rejection: ' + JSON.stringify(errs));

  await page.evaluate("Array.from(document.querySelectorAll('#errorNotice button')).find(b => b.textContent.trim() === 'Dismiss').click()");
  assert.equal(await page.evaluate(NOTICE_SHOWN), false, 'Dismiss hides it');
});

test('a throw from a timer callback is recorded and shown the same way', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("setTimeout(() => { throw new Error('thrown-on-purpose'); }, 0); " + SETTLE);
  assert.equal(await page.evaluate(NOTICE_SHOWN), true);
  const errs = await page.evaluate('window.__coach.errors().map(e => e.message)');
  assert.ok(errs.includes('thrown-on-purpose'), JSON.stringify(errs));
});

test('a burst of errors keeps every ring entry but shows the notice only once until the gap passes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("setTimeout(() => { Promise.reject(new Error('burst-1')); }, 0); " + SETTLE);
  assert.equal(await page.evaluate(NOTICE_SHOWN), true, 'the first error of the burst is announced');
  await page.evaluate("Array.from(document.querySelectorAll('#errorNotice button')).find(b => b.textContent.trim() === 'Dismiss').click()");
  await page.evaluate("setTimeout(() => { Promise.reject(new Error('burst-2')); }, 0); " + SETTLE);

  assert.equal(await page.evaluate(NOTICE_SHOWN), false, 'a dismissed notice does not pop straight back');
  const errs = await page.evaluate('window.__coach.errors().map(e => e.message)');
  assert.ok(errs.includes('burst-1') && errs.includes('burst-2'), 'both are recorded: ' + JSON.stringify(errs));
});

const SECRET_DEVICE = 'SECRET-DEVICE-ID-4711';
const SECRET_TITLE = 'My Secret Song Title';
const SEED_PROFILE = `try { if (!localStorage.getItem('bandcoach.v1')) localStorage.setItem('bandcoach.v1', JSON.stringify({ v: 1, prefs: { inputDeviceId: ${JSON.stringify(SECRET_DEVICE)} } })); } catch (e) {}`;
const FAKE_CLIPBOARD = `window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { window.__copied.push(String(s)); } } });`;
const SEED_SONG = `new Promise((resolve, reject) => {
  const req = indexedDB.open('bandcoach-songs', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); const s = tx.objectStore('kv');
    s.put({ id: 'seed1', title: ${JSON.stringify(SECRET_TITLE)} }, 'meta:seed1'); s.put({ id: 'seed1', title: ${JSON.stringify(SECRET_TITLE)} }, 'song:seed1');
    tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); };
})`;

test('Copy diagnostics copies version, browser, recent errors and capabilities, and never a song title or device id', async (t) => {
  const page = await launchPage(htmlPath, { initScript: SEED_PROFILE + FAKE_CLIPBOARD });
  t.after(() => page.close());

  assert.equal(await page.evaluate('window.__coach.db().prefs.inputDeviceId'), SECRET_DEVICE, 'the device id is really in the profile');
  assert.equal(await page.evaluate(SEED_SONG), true);
  assert.equal(await page.evaluate(`new Promise((resolve) => { const r = indexedDB.open('bandcoach-songs', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('meta:seed1'); g.onsuccess = () => resolve(g.result && g.result.title); }; })`), SECRET_TITLE, 'the song title is really stored');

  await page.evaluate("setTimeout(() => { Promise.reject(new Error('diag-error-marker')); }, 0); " + SETTLE);
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  assert.equal(await page.evaluate("!!document.getElementById('settingsView').querySelector('#diagCopyBtn')"), true, 'Settings has a Copy diagnostics button');
  await page.evaluate("document.getElementById('diagCopyBtn').click()");
  await page.waitFor('window.__copied.length === 1', 10000);
  const copied = await page.evaluate('window.__copied[0]');

  assert.match(copied, /Band Coach/);
  assert.ok(copied.includes(await page.evaluate('navigator.userAgent')), 'the browser string is in it');
  assert.match(copied, /diag-error-marker/, 'the recorded error message is in it');
  assert.match(copied, /microphone: (available|missing)/, 'capability states are in it');
  assert.ok(!copied.includes(SECRET_DEVICE), 'no device id');
  assert.ok(!copied.includes(SECRET_TITLE), 'no song title');
  assert.match(await page.evaluate("document.getElementById('diagCopyResult').textContent"), /Copied/, 'the learner is told it worked');
});

test('with no clipboard the diagnostics text is shown to select and copy by hand', async (t) => {
  const page = await launchPage(htmlPath, { initScript: "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });" });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  assert.equal(await page.evaluate("!!document.getElementById('diagCopyBtn')"), true, 'Settings has a Copy diagnostics button');
  await page.evaluate("document.getElementById('diagCopyBtn').click()");
  await page.waitFor("(() => { const a = document.getElementById('diagText'); return !!a && !a.hidden && /Band Coach/.test(a.value); })()", 10000);
  assert.match(await page.evaluate("document.getElementById('diagCopyResult').textContent"), /Select the text/, 'says what to do next');
});
