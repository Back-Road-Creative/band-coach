// modelNow (src/app.js ~:808) is frozen at page load (and re-set only by
// loadDB() and the progress-import path) and is the ONLY `now` the SRS ever
// sees -- see the comment on modelNow in src/app.js. A page left open for a
// day (or a phone tab backgrounded and resumed) never saw an item become due
// until reload, and evaluate()/retrievability() judged against stale
// page-load time. This characterizes the fix: modelNow is re-read from
// Date.now() (a) at the top of startSession(), so pressing Start after the
// tab has sat open picks up the real elapsed time, and (b) when the page
// becomes visible again (visibilitychange with document.hidden === false),
// so a backgrounded-then-resumed tab does not need a reload either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

test('model clock (fix): starting a session re-reads the clock instead of using the page-load value', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const loadTimeModelNow = await page.evaluate('window.__coach.modelNow()');

  // Freeze a base "now" and jump Date.now() two days ahead of it, simulating
  // a tab that has sat open (or backgrounded) since page load -- without
  // touching wall-clock time itself, which the rest of the app's break/backup
  // timers also read (see the finding: those are left alone deliberately).
  const stubbedNow = await page.evaluate(`
    (function () {
      const base = Date.now();
      const stubbed = base + ${TWO_DAYS_MS};
      Date.now = () => stubbed;
      return stubbed;
    })()
  `);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const afterStart = await page.evaluate('window.__coach.modelNow()');
  assert.ok(
    afterStart >= stubbedNow,
    `expected startSession() to refresh modelNow to the stubbed "now" (${stubbedNow}); ` +
      `page-load value was ${loadTimeModelNow}, got ${afterStart}`
  );
});

test('model clock (fix): the tab becoming visible again re-reads the clock, not merely going hidden', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const loadTimeModelNow = await page.evaluate('window.__coach.modelNow()');

  const stubbedNow = await page.evaluate(`
    (function () {
      const base = Date.now();
      const stubbed = base + ${TWO_DAYS_MS};
      Date.now = () => stubbed;
      return stubbed;
    })()
  `);

  // Simulate the tab going to the background: document.hidden becomes true
  // and a visibilitychange fires. This must NOT be the trigger -- the app is
  // backgrounded, not resumed, so there is nothing useful to refresh yet.
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  const afterHidden = await page.evaluate('window.__coach.modelNow()');
  assert.equal(
    afterHidden, loadTimeModelNow,
    'going hidden must not by itself move modelNow'
  );

  // Now simulate the tab coming back to the foreground.
  await page.evaluate(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  `);
  const afterVisible = await page.evaluate('window.__coach.modelNow()');
  assert.ok(
    afterVisible >= stubbedNow,
    `expected the tab becoming visible again to refresh modelNow to the stubbed "now" (${stubbedNow}); ` +
      `page-load value was ${loadTimeModelNow}, got ${afterVisible}`
  );
});
