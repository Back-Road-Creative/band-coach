// VERIFIED DEFECT (boot-without-storage): in Chrome with all site data
// blocked, and in some locked-down Safari setups, merely READING
// window.localStorage throws SecurityError. loadDB() passed the bare global to
// safeGet as an argument -- evaluated outside safeGet's try -- and the boot
// line that calls loadDB() had no try of its own, so the page stayed blank or
// half-wired with no explanation.
//
// These tests install a throwing getter BEFORE the page's own script runs and
// drive the real page: it must boot, tell the learner their progress cannot be
// saved on this device, and stay usable. A second test breaks a later step of
// boot and proves a visible "could not start" panel replaces the silent blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

// launchPage hands a page back only once <html data-coach-ready> is set, and
// the app sets it as the very last line of boot -- which is exactly the line a
// failed boot never reaches. So each init script also sets that attribute on
// DOMContentLoaded, which fires after the page's synchronous boot has run (or
// died). That lets these tests look at the outcome instead of timing out
// inside the helper; whether boot truly COMPLETED is asserted separately, by
// the debug hook (installed on boot's last lines) being present.
const MARK_LOADED = `
  document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-coach-ready', '1'));
`;

const THROWING_STORAGE_INIT = MARK_LOADED + `
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; },
  });
`;

const BREAK_BOOT_INIT = MARK_LOADED + `
  window.requestAnimationFrame = function () { throw new Error('frame loop refused to start'); };
`;

test('the app boots when reading window.localStorage throws, and says progress will not be kept', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: THROWING_STORAGE_INIT });
  t.after(() => page.close());

  assert.equal(await page.evaluate('typeof window.__coach'), 'object', 'boot must run to its last line, which installs the debug hook');
  assert.equal(await page.evaluate("!!document.getElementById('bootFailed')"), false, 'a blocked store is not a failed start');
  const say = await page.evaluate("document.getElementById('mainSay').textContent");
  assert.match(say, /could not be saved/i, `main screen must say saving is not working, got: ${JSON.stringify(say)}`);
  assert.equal(await page.evaluate("document.querySelectorAll('#mainNav button[data-route]').length > 0"), true, 'navigation is wired');
});

test('a boot with blocked storage is still usable: a drill runs and its save is reported failed', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: THROWING_STORAGE_INIT });
  t.after(() => page.close());

  assert.equal(await page.evaluate('typeof window.__coach'), 'object', 'boot must run to its last line, which installs the debug hook');
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.evaluate('document.querySelector(\'[data-route="settings"]\').click()');
  const settingsSay = await page.evaluate("document.getElementById('settingsSay').textContent");
  assert.match(settingsSay, /could not be saved/i);
});

test('a boot step that throws shows a visible could-not-start panel with the error text', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: BREAK_BOOT_INIT });
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('bootFailed') ? document.getElementById('bootFailed').getAttribute('role') : null"), 'alert');
  const text = await page.evaluate("document.getElementById('bootFailed').textContent");
  assert.match(text, /could not start/i);
  assert.match(text, /frame loop refused to start/, 'the error text is shown, not hidden');
  // The panel is for the learner; the error log and console are for everything that
  // watches a boot (release gate, acceptance lanes). A boot that threw must not look clean to them.
  const logged = await page.evaluate("window.__coach.errors().filter(e => e.where === 'boot').map(e => e.message)");
  assert.deepEqual(logged, ['frame loop refused to start'], 'the boot failure is recorded in the error log');
  assert.ok(page.consoleErrors.some((m) => /\[boot\]/.test(m)), `the boot failure is mirrored to console.error, got: ${JSON.stringify(page.consoleErrors)}`);
});

test('a healthy boot shows neither the storage notice nor the could-not-start panel', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  assert.equal(await page.evaluate("!!document.getElementById('bootFailed')"), false);
  assert.equal(await page.evaluate("document.getElementById('mainSay').textContent"), '');
});
