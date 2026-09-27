// VERIFIED DEFECT (storage-full): writeDB() in src/app.js used to be a bare
// `try { localStorage.setItem(KEY, lastStored); } catch (e) {}` -- a quota
// error, a SecurityError (private browsing / storage disabled), or a store
// that silently accepts the call but keeps something else were all
// swallowed with no trace, so the app behaved as though progress was saved
// when it never was. This stubs Storage.prototype.setItem to throw, the
// same way a real full quota does, and proves the learner is told in plain
// language through a real, already-visible role="status" element -- not
// through window.__coach, which only proves the debug hook saw it, not
// that a learner looking at the page would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const QUOTA_EXCEEDED_INIT = `
  window.__forceQuotaExceeded = true;
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (...args) {
    if (window.__forceQuotaExceeded) {
      const e = new Error('quota exceeded');
      e.name = 'QuotaExceededError';
      throw e;
    }
    return origSetItem.apply(this, args);
  };
`;

test('a save that cannot be written to this device tells the learner in plain language', async (t) => {
  const page = await launchPage(htmlPath, { initScript: QUOTA_EXCEEDED_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);

  // save() debounces the write; flush it synchronously via pagehide (the
  // same mechanism tests/characterization/save-flush-on-pagehide.test.mjs
  // already relies on) rather than waiting out the real 1200ms timer.
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  await page.evaluate('document.querySelector(\'[data-route="settings"]\').click()');
  const settingsSay = await page.evaluate("document.getElementById('settingsSay').textContent");
  assert.match(
    settingsSay,
    /could not be saved/i,
    `expected the visible Settings status region to report the failed save, got: ${JSON.stringify(settingsSay)}`
  );
});

test('a save that cannot be written is visible on the main practice screen, not only in Settings', async (t) => {
  const page = await launchPage(htmlPath, { initScript: QUOTA_EXCEEDED_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  // Settings is never opened in this test -- the learner is practising on
  // the main screen the whole time, which is the only screen a real
  // learner is ever looking at while playing.
  const settingsHidden = await page.evaluate("document.getElementById('settingsView').hidden");
  assert.equal(settingsHidden, true, 'sanity check: Settings is closed for this test');

  const mainSay = await page.evaluate("document.getElementById('mainSay').textContent");
  assert.match(
    mainSay,
    /could not be saved/i,
    `expected a visible status region on the main screen to report the failed save, got: ${JSON.stringify(mainSay)}`
  );
  const mainSayHidden = await page.evaluate("document.getElementById('mainSay').hidden");
  assert.equal(mainSayHidden, false, 'the main-screen save warning must actually be visible, not just have text');
});

test('the main-screen save warning clears once a later save succeeds', async (t) => {
  const page = await launchPage(htmlPath, { initScript: QUOTA_EXCEEDED_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  const failed = await page.evaluate("document.getElementById('mainSay').textContent");
  assert.match(failed, /could not be saved/i, 'sanity check: the failure message showed up first');

  await page.evaluate('window.__forceQuotaExceeded = false;');
  await page.waitFor('window.__coach.cur()');
  const midi2 = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi2}, true)`);
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  const cleared = await page.evaluate("document.getElementById('mainSay').textContent");
  assert.doesNotMatch(cleared, /could not be saved/i, `expected the main-screen warning to clear on a successful save, got: ${JSON.stringify(cleared)}`);
});

test('the failed-save status clears once a later save succeeds', async (t) => {
  const page = await launchPage(htmlPath, { initScript: QUOTA_EXCEEDED_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  await page.evaluate('document.querySelector(\'[data-route="settings"]\').click()');
  const failed = await page.evaluate("document.getElementById('settingsSay').textContent");
  assert.match(failed, /could not be saved/i, 'sanity check: the failure message showed up first');

  // Let real writes go through again, then trigger another save.
  await page.evaluate('window.__forceQuotaExceeded = false;');
  await page.waitFor('window.__coach.cur()');
  const midi2 = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi2}, true)`);
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  const cleared = await page.evaluate("document.getElementById('settingsSay').textContent");
  assert.doesNotMatch(cleared, /could not be saved/i, `expected the failure status to clear on a successful save, got: ${JSON.stringify(cleared)}`);
});
