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

test('the failed-save status clears once a later save succeeds', async (t) => {
  const page = await launchPage(htmlPath, { initScript: QUOTA_EXCEEDED_INIT });
  t.after(() => page.close());
  const SAY = "document.getElementById('settingsSay').textContent";

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);

  // Wait out save()'s own debounce rather than forcing a flush with a
  // synthetic pagehide: pagehide also tears the session down (E10,
  // src/core/session-teardown.js), which would stop the practice this test
  // needs to keep going for its second save.
  await page.waitFor(`/could not be saved/i.test(${SAY})`);

  // Let real writes go through again, then trigger another save.
  await page.evaluate('window.__forceQuotaExceeded = false;');
  await page.waitFor('window.__coach.cur()');
  const midi2 = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi2}, true)`);
  await page.waitFor(`!/could not be saved/i.test(${SAY})`);

  await page.evaluate('document.querySelector(\'[data-route="settings"]\').click()');
  const cleared = await page.evaluate(SAY);
  assert.doesNotMatch(cleared, /could not be saved/i, `expected the failure status to clear on a successful save, got: ${JSON.stringify(cleared)}`);
});
