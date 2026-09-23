// VERIFIED DEFECT (mic-connect-reentry): openMic() (src/app.js) only guarded
// against re-entry with `if (micReady) return true` BEFORE the `await
// getUserMedia(...)` call. #ioBtn stays visible (not hidden) until micReady
// flips true (ioRefresh, src/app.js), so a double-click on it — easy to do
// while waiting for the permission prompt or just impatient — ran
// getUserMedia() twice concurrently. The first call's resolved MediaStream
// was silently dropped (never wired in, never stopped): its tracks kept the
// mic hardware open and the OS mic indicator lit until the tab closed.
//
// This proves the fix by installing an `initScript` (runs before ANY page
// script, per tests/helpers/browser.mjs) that counts real
// navigator.mediaDevices.getUserMedia() calls, then driving the actual
// #ioBtn click twice back-to-back — exactly what an impatient learner does —
// and asserting only one getUserMedia() call was ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const COUNT_GET_USER_MEDIA_SCRIPT = `
  window.__gumCount = 0;
  const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function (...args) {
    window.__gumCount++;
    return origGetUserMedia(...args);
  };
`;

test('double-clicking the Connect microphone button opens one microphone, not two', async (t) => {
  const page = await launchPage(htmlPath, { initScript: COUNT_GET_USER_MEDIA_SCRIPT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");

  // Drive the real button twice back-to-back, exactly as a learner
  // double-clicking (or clicking again while the permission prompt is
  // pending) would -- #ioBtn stays visible until micReady flips true, so
  // nothing in the DOM stops a second click from firing.
  await page.evaluate(`
    (function () {
      const b = document.getElementById('ioBtn');
      b.click();
      b.click();
    })()
  `);

  await page.waitFor('window.__coach.db && document.getElementById("ioDot").className.indexOf("on") !== -1', 5000);

  const gumCount = await page.evaluate('window.__gumCount');
  assert.equal(gumCount, 1, `expected exactly one getUserMedia() call from a double-click, got ${gumCount}`);
});
