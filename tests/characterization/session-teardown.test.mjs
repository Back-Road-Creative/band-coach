// VERIFIED DEFECT (session-teardown): the visibilitychange handler
// (src/app.js) already calls takeBreak('hidden')/flushSave()/releaseNotes()
// on document.hidden, but never touches the microphone stream or the
// AudioContext -- a learner switching tabs or apps mid-session left the mic
// hardware open (OS mic indicator lit) and the AudioContext running until the
// tab was actually closed. This proves the real fix: hidden stops the mic
// tracks and suspends the AudioContext (src/core/session-teardown.js wired in
// on both visibilitychange->hidden and pagehide), and the next practice start
// after returning reopens the mic cleanly rather than silently staying dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the tab going hidden stops the microphone and suspends audio, not just pauses the session', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // 'gtr' has input: 'pluck', so Connect opens the real microphone.
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen() === true', 5000);

  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);

  await page.waitFor('window.__coach.micOpen() === false', 5000);
  const runsAfterHidden = await page.evaluate('window.__coach.teardownRuns()');
  assert.ok(runsAfterHidden >= 1, `expected at least one teardown run after going hidden, got ${runsAfterHidden}`);

  const audioSuspended = await page.evaluate('window.__coach.audioSuspended()');
  assert.equal(audioSuspended, true, 'expected the AudioContext to be suspended after the tab went hidden');
});

test('pagehide also stops the microphone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen() === true', 5000);

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  const micOpen = await page.evaluate('window.__coach.micOpen()');
  assert.equal(micOpen, false, 'expected pagehide to stop the microphone too');
});

test('after the tab returns to visible, the learner\'s next action reopens the microphone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen() === true', 5000);

  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await page.waitFor('window.__coach.micOpen() === false', 5000);

  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  `);

  // The real entry point a returning learner uses: the Connect microphone
  // button that ioRefresh() now correctly shows again (micReady went false),
  // not the debug hook.
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen() === true', 5000);
});
