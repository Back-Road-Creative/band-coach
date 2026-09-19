// CURRENT BEHAVIOUR: opening band-coach.html straight from disk (file://,
// the way a learner double-clicks it) must boot with zero uncaught errors,
// and today's only network traffic is the Google Fonts stylesheet + its
// woff2 files. A new request host is a behaviour change the next unit
// (the module split) must not introduce silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = fileURLToPath(new URL('../../band-coach.html', import.meta.url));
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

test('loads from file:// with zero uncaught errors and only the known font hosts', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate('document.title'), 'Band Coach');
  assert.equal(await page.evaluate("typeof window.__coach"), 'object', 'debug hook is present');

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions during boot');
  assert.deepEqual(page.consoleErrors, [], 'no console.error during boot');

  const offenders = page.requests.filter((url) => {
    if (url.startsWith('file://')) return false;
    const host = new URL(url).host;
    return !ALLOWED_HOSTS.has(host);
  });
  assert.deepEqual(offenders, [], 'a request to a new host is a behaviour change: ' + JSON.stringify(page.requests));
  assert.ok(page.requests.length >= 2, 'expected at least the page load and a fonts request');
});
