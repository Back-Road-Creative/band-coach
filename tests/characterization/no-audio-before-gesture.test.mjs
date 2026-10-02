// VERIFIED DEFECT (hand test of the v1.9.0 download in Windows Chrome,
// 2026-10-01): the console showed "The AudioContext was not allowed to start.
// It must be resumed (or created) after a user gesture on the page." twice.
// Cause: the visible branch of visibilitychange and the bfcache pageshow
// handler call ensureAudio(), and ensureAudio() CREATES the context when
// none exists yet (src/app.js). Neither event is a user gesture, so a learner
// who opens the file, reads for a moment, switches tabs and comes back gets
// a context created outside any gesture -- once per return. The headless
// suite never sees the warning because it launches with
// --autoplay-policy=no-user-gesture-required.
//
// The fix keeps what resume-on-return.test.mjs pins (a context that exists
// and was suspended by the teardown IS resumed on return) but never creates
// one from those two handlers: creation stays on the gesture paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('coming back to a page that never played anything creates no AudioContext', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  assert.equal(await page.evaluate('window.__coach.audioExists()'), false);

  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  assert.equal(await page.evaluate('window.__coach.audioExists()'), false, 'visibilitychange created a context without a gesture');

  await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))");
  assert.equal(await page.evaluate('window.__coach.audioExists()'), false, 'pageshow created a context without a gesture');
});

test('a context that exists and is suspended is still resumed on return', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('tuner')");
  await page.evaluate("window.__coach.testSource([440])");
  assert.equal(await page.evaluate('window.__coach.audioExists()'), true);
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await page.waitFor('window.__coach.audioSuspended() === true');
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  await page.waitFor('window.__coach.audioSuspended() === false');
});
