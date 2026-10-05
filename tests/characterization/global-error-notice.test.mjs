// A throw that escapes frame()/onPitch (a rejected promise, a MIDI handler, an
// openMic chain) used to reach only the console: practice went quiet with no
// word to the learner and nothing for the maker. Now window 'error' and
// 'unhandledrejection' record into the error ring and show one dismissible,
// rate-limited notice; Settings has a Copy diagnostics button whose text is
// built from an allow-list (no song titles, device ids or audio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';

const htmlPath = HTML_PATH;
const RING_HAS = (msg) => `window.__coach.errors().some(e => e.message === ${JSON.stringify(msg)})`;
const REJECT = (msg) => `setTimeout(() => { Promise.reject(new Error(${JSON.stringify(msg)})); }, 0)`;
const NOTICE_SHOWN = "(() => { const n = document.getElementById('errorNotice'); return !!n && !n.hidden; })()";

test('an unhandled promise rejection is recorded and the learner is told, with a way to dismiss it', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate(NOTICE_SHOWN), false, 'a clean boot shows no notice');
  await page.evaluate(REJECT('rejected-on-purpose'));
  await page.waitFor(NOTICE_SHOWN, 10000);

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

  await page.evaluate("setTimeout(() => { throw new Error('thrown-on-purpose'); }, 0)");
  await page.waitFor(NOTICE_SHOWN, 10000);
  assert.equal(await page.evaluate(NOTICE_SHOWN), true);
  const errs = await page.evaluate('window.__coach.errors().map(e => e.message)');
  assert.ok(errs.includes('thrown-on-purpose'), JSON.stringify(errs));
});

test('a burst of errors keeps every ring entry but shows the notice only once until the gap passes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(REJECT('burst-1'));
  await page.waitFor(NOTICE_SHOWN, 10000);
  assert.equal(await page.evaluate(NOTICE_SHOWN), true, 'the first error of the burst is announced');
  await page.evaluate("Array.from(document.querySelectorAll('#errorNotice button')).find(b => b.textContent.trim() === 'Dismiss').click()");
  await page.evaluate(REJECT('burst-2'));
  await page.waitFor(RING_HAS('burst-2'), 10000); // the second error has fully landed before we look for a notice

  assert.equal(await page.evaluate(NOTICE_SHOWN), false, 'a dismissed notice does not pop straight back');
  const errs = await page.evaluate('window.__coach.errors().map(e => e.message)');
  assert.ok(errs.includes('burst-1') && errs.includes('burst-2'), 'both are recorded: ' + JSON.stringify(errs));
});

test('once the gap has passed a new error is announced again, and never as a second notice on top of the first', async (t) => {
  const page = await launchPage(htmlPath, { initScript: 'window.__now = 1e12; Date.now = () => window.__now;' });
  t.after(() => page.close());
  const COUNT = "document.querySelectorAll('#errorNotice').length";

  await page.evaluate(REJECT('gap-1'));
  await page.waitFor(NOTICE_SHOWN, 10000);
  await page.evaluate('window.__now += 31000');
  await page.evaluate(REJECT('gap-2'));
  await page.waitFor(RING_HAS('gap-2'), 10000);
  assert.equal(await page.evaluate(COUNT), 1, 'one notice on screen, not two stacked');

  await page.evaluate("document.querySelector('#errorNotice button').click()");
  await page.evaluate('window.__now += 31000');
  await page.evaluate(REJECT('gap-3'));
  await page.waitFor(RING_HAS('gap-3'), 10000);
  await page.waitFor(NOTICE_SHOWN, 10000);
  assert.equal(await page.evaluate(COUNT), 1, 'after a dismissal and a long enough gap the notice comes back');
});

const SHOWN_TEXT = "(document.getElementById('diagCopyText') || {}).textContent || ''";
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

  await page.evaluate(REJECT('diag-error-marker'));
  await page.waitFor(RING_HAS('diag-error-marker'), 10000);
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  assert.equal(await page.evaluate("!!document.getElementById('settingsView').querySelector('#diagCopyBtn')"), true, 'Settings has a Copy diagnostics button');
  await page.evaluate("document.getElementById('diagCopyBtn').click()");
  await page.waitFor('window.__copied.length === 1', 10000);
  const copied = await page.evaluate('window.__copied[0]');

  assert.match(copied, /Band Coach/);
  assert.ok(copied.includes(await page.evaluate('navigator.userAgent')), 'the browser string is in it');
  assert.match(copied, /diag-error-marker/, 'the recorded error message is in it');
  assert.match(copied, /"microphone":(true|false)/, 'capability states are in it');
  assert.ok(!copied.includes(SECRET_DEVICE), 'no device id');
  assert.ok(!copied.includes(SECRET_TITLE), 'no song title');
  await page.waitFor("document.getElementById('diagCopyResult').textContent !== ''", 10000); // the handler finishes after the clipboard promise settles
  const status = await page.evaluate("document.getElementById('diagCopyResult').textContent");
  assert.match(status, /Copied/, 'the learner is told it worked');
  assert.ok(!status.includes('Features:') && !status.includes('Browser:'), 'the live status line holds the short message only, so a screen reader does not read the whole report out');
  assert.equal(await page.evaluate(SHOWN_TEXT), copied, 'the text that was copied is also shown, to check what is shared');
  assert.equal(await page.evaluate("!!(document.getElementById('diagCopyText') || document.body).closest('[role], [aria-live]')"), false, 'and that text is not inside a live region');
});

test('with no clipboard the diagnostics text is shown to select and copy by hand', async (t) => {
  const page = await launchPage(htmlPath, { initScript: "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });" });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  assert.equal(await page.evaluate("!!document.getElementById('diagCopyBtn')"), true, 'Settings has a Copy diagnostics button');
  await page.evaluate("document.getElementById('diagCopyBtn').click()");
  await page.waitFor("document.getElementById('diagCopyResult').textContent !== ''", 10000);
  assert.match(await page.evaluate(SHOWN_TEXT), /Band Coach/, 'the text to copy is on screen');
  const status = await page.evaluate("document.getElementById('diagCopyResult').textContent");
  assert.match(status, /Select this text/, 'says what to do next');
  assert.ok(!status.includes('Browser:'), 'the live status line holds the short message only');
});

// The 50 ms pitch timer (listen) runs outside frame()'s try. With no AudioWorklet it is the live pitch path;
// a throw there is recorded under its own name, and a long streak is reported 3 times, not on every tick.
const LISTEN_RECORDS = "window.__coach.errors().filter(e => e.where === 'listen').length";
const FLAKY_ANALYSER = `window.__tdCalls = 0; window.__tdBroken = false;
  const realTD = AnalyserNode.prototype.getFloatTimeDomainData;
  AnalyserNode.prototype.getFloatTimeDomainData = function (a) { window.__tdCalls++; if (window.__tdBroken) throw new Error('analyser-broke'); return realTD.call(this, a); };`;
const NO_WORKLET = "Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: undefined });";

test('a throw inside the 50 ms pitch timer is recorded as listen, announced, and capped per streak', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'global-error-listen-'));
  const wavPath = join(dir, 'steady.wav');
  writePluckWav(wavPath, pluck(220, 48000, 6.0, { seed: 5, steady: true }), 48000);
  const page = await launchPage(htmlPath, { initScript: NO_WORKLET + FLAKY_ANALYSER, fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr'); window.__coach.setNoiseFloorForTest(0.001)"); // a stored room floor: no room check competes for the analyser
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__tdCalls > 5', 15000); // the timer is reading the analyser
  assert.equal(await page.evaluate(LISTEN_RECORDS), 0, 'a healthy timer records nothing');

  await page.evaluate('window.__tdBroken = true; window.__tdCalls = 0');
  await page.waitFor('window.__tdCalls >= 8', 10000); // the timer kept ticking through every throw
  assert.equal(await page.evaluate(LISTEN_RECORDS), 3, 'the first 3 of the streak are recorded, not one per tick');
  assert.equal(await page.evaluate(NOTICE_SHOWN), true, 'and the learner is told');

  await page.evaluate('window.__tdBroken = false; window.__tdCalls = 0');
  await page.waitFor('window.__tdCalls >= 3', 10000); // a good tick ends the streak
  await page.evaluate('window.__tdBroken = true; window.__tdCalls = 0');
  await page.waitFor('window.__tdCalls >= 8', 10000);
  assert.equal(await page.evaluate(LISTEN_RECORDS), 6, 'a new streak is recorded again');
});
