// CURRENT BEHAVIOUR: opening band-coach.html straight from disk (file://,
// the way a learner double-clicks it) must boot with zero uncaught errors
// and make NO network request beyond loading the page itself — no Google
// Fonts call, no other host. It must also be a valid document: an `lang`
// attribute, a <title> in <head>, no <style>/<link>/<title> left inside
// <body>, and a viewport that sets initial-scale (fixes E1/E2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('loads from file:// with zero uncaught errors and no network requests other than the page itself', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate('document.title'), 'Band Coach');
  assert.equal(await page.evaluate("typeof window.__coach"), 'object', 'debug hook is present');

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions during boot');
  assert.deepEqual(page.consoleErrors, [], 'no console.error during boot');

  const nonFileRequests = page.requests.filter((url) => !url.startsWith('file://'));
  assert.deepEqual(
    nonFileRequests,
    [],
    'no network requests other than the file:// page itself: ' + JSON.stringify(page.requests)
  );

  assert.equal(await page.evaluate('document.documentElement.lang'), 'en', 'html has lang="en"');
  assert.equal(
    await page.evaluate("Boolean(document.head.querySelector('title'))"),
    true,
    'title lives in <head>'
  );
  assert.equal(
    await page.evaluate("Boolean(document.body.querySelector('style, link, title'))"),
    false,
    'no style/link/title left inside <body>'
  );
  const viewport = await page.evaluate("document.querySelector('meta[name=viewport]').getAttribute('content')");
  assert.match(viewport, /initial-scale=1/, 'viewport sets initial-scale=1');
});
