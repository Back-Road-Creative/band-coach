// New behaviour (unit 7.7 item 7 / plan E10): a practice session requests a
// screen wake lock so the device does not sleep mid-exercise, and releases
// it when the session ends. Chromium headless does not implement the real
// Wake Lock API reliably over file://, so a fake is installed before the
// page's own script runs (Page.addScriptToEvaluateOnNewDocument) and its
// calls are recorded on window for the test to inspect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const FAKE_WAKE_LOCK_INIT = `
  window.__wakeLockCalls = [];
  window.__wakeLockSentinels = [];
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async (kind) => {
        window.__wakeLockCalls.push(kind);
        let released = false;
        const listeners = {};
        const sentinel = {
          released: false,
          addEventListener: (name, fn) => { listeners[name] = fn; },
          release: async () => { released = true; sentinel.released = true; if (listeners.release) listeners.release(); },
        };
        window.__wakeLockSentinels.push(sentinel);
        return sentinel;
      },
    },
  });
`;

test('starting a session requests a screen wake lock', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_WAKE_LOCK_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const calls = await page.evaluate('window.__wakeLockCalls');
  assert.deepEqual(calls, ['screen']);
});

test('ending a session releases the wake lock', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_WAKE_LOCK_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  await page.waitFor('window.__wakeLockSentinels.length === 1');

  await page.evaluate("document.getElementById('endBtn').click()");
  await page.waitFor('window.__wakeLockSentinels[0].released === true');

  const released = await page.evaluate('window.__wakeLockSentinels[0].released');
  assert.equal(released, true);
});
