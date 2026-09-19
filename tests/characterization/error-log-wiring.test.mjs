// E6: caught errors (src/app.js frame()/onPitch() catch blocks) were
// swallowed with `errCount++` and nothing else. They are now recorded into
// src/core/error-log.js and exposed through the debug hook as `errors`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the debug hook exposes an errors() getter backed by the error-log ring', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const type = await page.evaluate("typeof window.__coach.errors");
  assert.equal(type, 'function', 'window.__coach.errors is exposed');

  const errors = await page.evaluate('window.__coach.errors()');
  assert.deepEqual(errors, [], 'a clean boot with no thrown errors starts with an empty ring');
});
