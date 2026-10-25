// The error notice tells the learner to reload and then use Settings > Copy
// diagnostics. The errors from before the reload must still be in that report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('an error from before a reload is still in Copy diagnostics after it', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await page.evaluate("window.dispatchEvent(new ErrorEvent('error', { error: new Error('p4-before-reload'), message: 'p4-before-reload' }))");
  await page.reload();
  await page.evaluate("document.getElementById('diagCopyBtn').click()");
  await page.waitFor("!document.getElementById('diagCopyText').hidden");
  assert.match(await page.evaluate("document.getElementById('diagCopyText').textContent"), /p4-before-reload/);
});
