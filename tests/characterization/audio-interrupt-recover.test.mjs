// VERIFIED DEFECT (audio-interrupt-recover): now() is actx.currentTime, so a
// context the browser or OS stops freezes the app clock. iOS does this for a
// phone call, Siri or an AirPods route change -- state 'interrupted', with no
// visibilitychange at all -- and resumeAudio() only ever handled 'suspended'
// and only from visibilitychange/pageshow. The exercise then sat frozen and
// silent with no message. The app must notice the state change itself, say so
// in plain words, and recover on the learner's next tap; a 'closed' context
// is unrecoverable and must be rebuilt rather than resumed. A resume that is
// refused (or settles with the context still stopped, as iOS does mid-call)
// fires no further statechange, so the app must say so again, not stay frozen.
// Every wait below is on the condition asserted; the only bounded sleeps are
// the two negative checks that nothing was thrown/raised, and those first wait
// for the thing that would have caused it.
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

// Pages every statechange the app's own handler has already seen: the test's
// listener is added after the app's onstatechange, so it runs after it.
const WATCH_STATES = `(() => { window.__seen = []; const c = window.__ctxs[0]; c.addEventListener('statechange', () => window.__seen.push(c.state)); })()`;

async function startSession(t) {
  const page = await launchPage(htmlPath, { initScript: RECORD_CONTEXTS_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  await page.waitFor("window.__ctxs.length === 1 && window.__ctxs[0].state === 'running'");
  await page.evaluate(WATCH_STATES);
  return page;
}

// A session in a microphone mod with the fake device's real stream open.
async function startMicSession(t, mod, { session = true, noMidi = false } = {}) {
  // A drum kit tries MIDI first; with no Web MIDI at all it falls back to the microphone.
  const page = await launchPage(htmlPath, { initScript: RECORD_CONTEXTS_INIT + (noMidi ? 'navigator.requestMIDIAccess = undefined;' : '') });
  t.after(() => page.close());
  await page.evaluate(`window.__coach.setMod(${JSON.stringify(mod)})`);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen()', 8000);
  if (session) {
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  }
  await page.waitFor("window.__ctxs.length === 1 && window.__ctxs[0].state === 'running'");
  return page;
}

const cardUp = (page) => page.evaluate("!document.getElementById('breakCard').hidden");
const CARD_UP = "!document.getElementById('breakCard').hidden";
const coachText = (page) => page.evaluate("document.getElementById('coach').textContent");
// The Safari shape on the real context: a state getter the test controls, plus
// the statechange event the browser fires (Chromium never reports 'interrupted').
const FAKE_STATE = `
  const c = window.__ctxs[0]; let st = 'interrupted';
  Object.defineProperty(c, 'state', { configurable: true, get: () => st });
`;

test('a context suspended mid-session pauses with a plain message and recovers on tap', async (t) => {
  const page = await startSession(t);

  await page.evaluate('window.__ctxs[0].suspend()');
  await page.waitFor(CARD_UP);

  assert.match(await coachText(page), /tap to resume sound/i);
  assert.equal(await page.evaluate('window.__coach.playing()'), false);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("window.__ctxs[0].state === 'running'");
  assert.equal(await cardUp(page), false);
  assert.equal(await page.evaluate('window.__coach.playing()'), true);
});

test("an 'interrupted' context (iOS call or route change) is treated the same and resumed on tap", async (t) => {
  const page = await startSession(t);

  await page.evaluate(`${FAKE_STATE}
    c.resume = async () => { st = 'running'; c.dispatchEvent(new Event('statechange')); };
    c.dispatchEvent(new Event('statechange'));
  `);

  assert.equal(await cardUp(page), true, 'an interrupted context mid-session must raise the pause card');
  assert.match(await coachText(page), /tap to resume sound/i);

  await page.evaluate("document.getElementById('playBtn').click()");
  assert.equal(await page.evaluate("window.__ctxs[0].state"), 'running');
  assert.equal(await cardUp(page), false);
});

test('a rejected resume is recorded, not thrown, and the learner is told again', async (t) => {
  const page = await startSession(t);
  await page.evaluate(`${FAKE_STATE}
    window.__unhandled = 0; window.addEventListener('unhandledrejection', () => { window.__unhandled++; });
    window.__resumeCalls = 0; c.resume = () => { window.__resumeCalls++; return Promise.reject(new Error('resume refused')); };
    c.dispatchEvent(new Event('statechange'));
  `);
  await page.waitFor(CARD_UP);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__resumeCalls >= 1');
  // Negative check (nothing escaped as an unhandled rejection): the rejection is
  // already seen by the time resume() was called, so a short bounded wait is enough.
  await page.evaluate('new Promise(r => setTimeout(r, 100))');
  assert.equal(await page.evaluate('window.__unhandled'), 0);
  assert.ok(await page.evaluate("window.__coach.errors().some(e => /resume refused/.test(e.message))"));
  // The tap hid the card; a refused resume fires no statechange, so the app must raise it again itself.
  await page.waitFor(CARD_UP);
  assert.equal(await page.evaluate('window.__coach.playing()'), false);
});

test("a resume that settles with the context still 'interrupted' raises the pause card again", async (t) => {
  const page = await startSession(t);
  await page.evaluate(`${FAKE_STATE}
    window.__resumeCalls = 0; c.resume = async () => { window.__resumeCalls++; };
    c.dispatchEvent(new Event('statechange'));
  `);
  await page.waitFor(CARD_UP);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__resumeCalls >= 1');
  await page.waitFor(CARD_UP);
  assert.equal(await page.evaluate('window.__coach.playing()'), false);
  assert.match(await coachText(page), /tap to resume sound/i);
});

test('a closed context is dropped and the next tap builds a working one', async (t) => {
  const page = await startSession(t);

  await page.evaluate('window.__ctxs[0].close()');
  await page.waitFor('!window.__coach.audioExists()');
  await page.waitFor(CARD_UP);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("window.__ctxs.length === 2 && window.__ctxs[1].state === 'running'");
  assert.equal(await page.evaluate('window.__coach.audioExists()'), true);
  assert.equal(await page.evaluate('window.__coach.playing()'), true);
});

test('a closed context zeroes the worklet pitch clock, tells the learner the mic is gone, and offers Connect', async (t) => {
  const page = await startMicSession(t, 'gtr');
  // A real worklet frame has stamped the dead context's clock (the stale value the rebuilt, near-zero clock must never meet).
  await page.waitFor('window.__coach.pitchClocks()[1] > 0');

  await page.evaluate('window.__ctxs[0].close()');
  await page.waitFor('!window.__coach.audioExists()');
  await page.waitFor(CARD_UP);

  assert.deepEqual(await page.evaluate('window.__coach.pitchClocks()'), [0, 0], 'the old context\'s clock must not survive into the rebuilt one');
  assert.equal(await page.evaluate('window.__coach.micOpen()'), false);

  await page.evaluate("document.getElementById('playBtn').click()");
  assert.match(await coachText(page), /Press Connect microphone/, 'the learner must be told the mic needs reconnecting');
  await page.waitFor("window.__ctxs.length === 2 && window.__ctxs[1].state === 'running'");
});

test('a closed context zeroes the fallback pitch clock too (drum-kit mic path)', async (t) => {
  const page = await startMicSession(t, 'drum-kit', { session: false, noMidi: true });
  await page.waitFor('window.__coach.pitchClocks()[0] > 0');

  await page.evaluate('window.__ctxs[0].close()');
  await page.waitFor('!window.__coach.audioExists()');

  assert.deepEqual(await page.evaluate('window.__coach.pitchClocks()'), [0, 0]);
});

test('negative control: the tab-hide suspend does not pause, and a later real interruption still does', async (t) => {
  const page = await startSession(t);

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.waitFor("window.__seen.includes('suspended')");
  // pagehide is the app's own teardown: it must not be mistaken for an OS
  // interruption (no pause card, the task survives for the bfcache return).
  assert.equal(await cardUp(page), false);
  assert.ok(await page.evaluate('window.__coach.task()'));

  await page.evaluate(`
    const ev = new Event('pageshow'); Object.defineProperty(ev, 'persisted', { value: true }); window.dispatchEvent(ev);
  `);
  await page.waitFor("window.__ctxs[0].state === 'running'");
  assert.equal(await cardUp(page), false);

  // Back from the bfcache the app is no longer parked: a real interruption must be reported again.
  await page.evaluate('window.__ctxs[0].suspend()');
  await page.waitFor(CARD_UP);
});

test('negative control: a pagehide park is cleared by the tab becoming visible again', async (t) => {
  const page = await startSession(t);

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.waitFor("window.__seen.includes('suspended')");
  assert.equal(await cardUp(page), false);

  await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await page.waitFor("window.__ctxs[0].state === 'running'");

  await page.evaluate('window.__ctxs[0].suspend()');
  await page.waitFor(CARD_UP);
});
