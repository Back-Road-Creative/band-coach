// VERIFIED DEFECT (audio-interrupt-recover): now() is actx.currentTime, so a
// context the browser or OS stops freezes the app clock. iOS does this for a
// phone call, Siri or an AirPods route change -- state 'interrupted', with no
// visibilitychange at all -- and resumeAudio() only ever handled 'suspended'
// and only from visibilitychange/pageshow. The exercise then sat frozen and
// silent with no message. The app must notice the state change itself, say so
// in plain words, and recover on the learner's next tap; a 'closed' context
// is unrecoverable and must be rebuilt rather than resumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Records every AudioContext the page builds on window.__ctxs, so a test can
// reach the real context the app is using without the debug hook.
const RECORD_CONTEXTS_INIT = `
  window.__ctxs = [];
  const Real = window.AudioContext;
  window.AudioContext = function (...args) { const c = new Real(...args); window.__ctxs.push(c); return c; };
  window.AudioContext.prototype = Real.prototype;
`;

const settle = (page) => page.evaluate('new Promise(r => setTimeout(r, 150))');

async function startSession(t) {
  const page = await launchPage(htmlPath, { initScript: RECORD_CONTEXTS_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  await page.waitFor("window.__ctxs.length === 1 && window.__ctxs[0].state === 'running'");
  return page;
}

const cardUp = (page) => page.evaluate("!document.getElementById('breakCard').hidden");

test('a context suspended mid-session pauses with a plain message and recovers on tap', async (t) => {
  const page = await startSession(t);

  await page.evaluate('window.__ctxs[0].suspend()');
  await settle(page);

  assert.equal(await cardUp(page), true, 'a suspended context mid-session must raise the pause card');
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /tap to resume sound/i);
  assert.equal(await page.evaluate('window.__coach.playing()'), false);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("window.__ctxs[0].state === 'running'");
  assert.equal(await cardUp(page), false);
  assert.equal(await page.evaluate('window.__coach.playing()'), true);
});

test("an 'interrupted' context (iOS call or route change) is treated the same and resumed on tap", async (t) => {
  const page = await startSession(t);

  // Chromium never reports 'interrupted'; install the Safari shape on the
  // real context: a state getter plus the statechange event the browser fires.
  await page.evaluate(`
    const c = window.__ctxs[0]; let st = 'interrupted';
    Object.defineProperty(c, 'state', { configurable: true, get: () => st });
    c.resume = async () => { st = 'running'; c.dispatchEvent(new Event('statechange')); };
    c.dispatchEvent(new Event('statechange'));
  `);

  assert.equal(await cardUp(page), true, 'an interrupted context mid-session must raise the pause card');
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /tap to resume sound/i);

  await page.evaluate("document.getElementById('playBtn').click()");
  assert.equal(await page.evaluate("window.__ctxs[0].state"), 'running');
  assert.equal(await cardUp(page), false);
});

test('a rejected resume is recorded, not thrown as an unhandled rejection', async (t) => {
  const page = await startSession(t);
  await page.evaluate(`
    window.__unhandled = 0; window.addEventListener('unhandledrejection', () => { window.__unhandled++; });
    const c = window.__ctxs[0]; let st = 'interrupted';
    Object.defineProperty(c, 'state', { configurable: true, get: () => st });
    c.resume = () => Promise.reject(new Error('resume refused'));
    c.dispatchEvent(new Event('statechange'));
    document.getElementById('playBtn').click();
  `);
  await settle(page);
  assert.equal(await page.evaluate('window.__unhandled'), 0);
  assert.ok(await page.evaluate("window.__coach.errors().some(e => /resume refused/.test(e.message))"));
});

test('a closed context is dropped and the next tap builds a working one', async (t) => {
  const page = await startSession(t);

  await page.evaluate('window.__ctxs[0].close()');
  await settle(page);

  assert.equal(await page.evaluate('window.__coach.audioExists()'), false, 'a closed context must be dropped, not kept');
  assert.equal(await cardUp(page), true);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("window.__ctxs.length === 2 && window.__ctxs[1].state === 'running'");
  assert.equal(await page.evaluate('window.__coach.audioExists()'), true);
  assert.equal(await page.evaluate('window.__coach.playing()'), true);
});

test('negative control: a tab-hide suspend still pauses only once and returns cleanly', async (t) => {
  const page = await startSession(t);

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.waitFor("window.__ctxs[0].state === 'suspended'");
  await settle(page);
  // pagehide is the app's own teardown: it must not be mistaken for an OS
  // interruption (no pause card, the task survives for the bfcache return).
  assert.equal(await cardUp(page), false);
  assert.ok(await page.evaluate('window.__coach.task()'));

  await page.evaluate(`
    const ev = new Event('pageshow'); Object.defineProperty(ev, 'persisted', { value: true }); window.dispatchEvent(ev);
  `);
  await page.waitFor("window.__ctxs[0].state === 'running'");
  assert.equal(await cardUp(page), false);
});
