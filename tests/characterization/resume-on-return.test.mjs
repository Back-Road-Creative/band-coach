// VERIFIED DEFECT (resume-on-return): session-teardown.js's stopper suspends
// the shared AudioContext when the tab goes hidden (visibilitychange) or on
// pagehide (src/app.js). The app's own clock, now(), is actx.currentTime,
// which freezes solid while the context stays suspended -- and the ONLY place
// that resumes a suspended context is ensureAudio(), called from pointer/key
// input on the canvas/tap pad, never from the visible branch of
// visibilitychange (which only calls refreshModelClock()/ioRefresh()) and
// never from a bfcache pageshow. A learner who switches tabs mid-lesson and
// comes back gets a session whose clock never moves again: nextTaskAt was
// scheduled against a now() that stopped ticking, so the next task never
// becomes due no matter how long the learner waits or how many correct notes
// they play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// A full practice session already forces a manual "Resume" click on the way
// back from a hidden tab (visibilitychange's hidden branch calls
// takeBreak('hidden') whenever a session is playing, which is a deliberate
// break UI and already calls ensureAudio() itself from resume()). The tool
// modes (tuner, capture) have no session and no such gate: nothing there ever
// calls ensureAudio() again on return, so this is where the visible branch's
// own resume call is the only thing standing between a returning learner and
// a permanently suspended AudioContext.
test('returning to a tool mode (no session) resumes audio with no click needed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('tuner')");
  await page.evaluate("window.__coach.testSource([440])");
  assert.equal(await page.evaluate('window.__coach.audioSuspended()'), false);

  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await page.waitFor('window.__coach.audioSuspended() === true');

  // Come back: no button click, no note played -- just the tab regaining
  // visibility, which is all a learner does by switching back.
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await page.waitFor('window.__coach.audioSuspended() === false');
});

test('a bfcache pageshow (persisted) resumes a context that pagehide suspended', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.waitFor('window.__coach.audioSuspended() === true');

  await page.evaluate(`
    const ev = new Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);
  `);
  await page.waitFor('window.__coach.audioSuspended() === false');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task().done || window.__coach.task().idx > 0');
});
