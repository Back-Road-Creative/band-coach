// A browser with no getUserMedia says so in plain words on both paths that
// need a microphone: pressing Connect (the status line) and pressing Start on
// a microphone instrument (status line AND the coach line, the same message).
// Both paths share one message in src/app.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const MSG = 'This browser cannot open a microphone here. Open the standalone copy in Chrome.';
const NO_GUM = "Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });";

test('with no getUserMedia, Connect and Start both say the browser cannot open a microphone', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: NO_GUM });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");

  await page.evaluate("document.getElementById('ioBtn').click()");
  assert.equal(await page.evaluate("document.getElementById('ioText').textContent"), MSG);

  await page.evaluate("document.getElementById('ioText').textContent = ''");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("document.getElementById('coach').textContent.includes('cannot open a microphone')", 5000);
  assert.equal(await page.evaluate("document.getElementById('coach').textContent"), MSG);
  assert.equal(await page.evaluate("document.getElementById('ioText').textContent"), MSG);
  assert.deepEqual(page.exceptions, []);
});
