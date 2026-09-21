// A downloaded band-coach.html can never rewrite or replace itself, so the
// "Check for updates" button is the honest alternative: it asks, on press
// only, and answers in place next to the version footer. This drives the
// REAL button through the REAL app wiring (not window.__coach, which is
// stripped from the release build) with window.fetch faked before the
// page's own script runs, since the built HTML always carries a real
// published version (package.json's, currently 1.3.0) rather than the dev
// sentinel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// dist/band-coach.html (the plain dev build the test suite runs against,
// see tests/helpers/html-path.mjs) never stamps a real version into
// <meta name="band-coach-version"> -- only `--release` does that (see
// build/build.mjs). To exercise the up-to-date/behind/error states, which
// only make sense for a real release version, this fakes that ONE
// document.querySelector('meta[name="band-coach-version"]') lookup before
// the page's own script runs -- the exact call src/app.js makes -- to the
// published version this repo's package.json currently carries (1.3.0),
// so the comparison logic sees a real version without needing the release
// build's minified/hook-stripped output.
const FAKE_RELEASE_VERSION_INIT = `
  const __realQuerySelector = document.querySelector.bind(document);
  document.querySelector = function (sel) {
    if (sel === 'meta[name="band-coach-version"]') return { content: '1.3.0' };
    return __realQuerySelector(sel);
  };
`;

function fakeFetchInit(handler, { fakeVersion = false } = {}) {
  return `
    ${fakeVersion ? FAKE_RELEASE_VERSION_INIT : ''}
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      window.__fetchCalls.push(String(url));
      return (${handler})(String(url), opts);
    };
  `;
}

test('the button and its plain-language helper text are visible before any press', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("Boolean(document.getElementById('updateCheckBtn'))"), true);
  const help = await page.evaluate("document.getElementById('updateCheckHelp').textContent");
  assert.match(help, /version/i);
  assert.match(help, /nothing about your playing/i, 'says in plain words what it does and does not send');
});

test('loading the page makes no request at all -- nothing on load, no timer, no press', async (t) => {
  const page = await launchPage(htmlPath, { initScript: fakeFetchInit('async () => { throw new Error("must not be called"); }') });
  t.after(() => page.close());

  // Give any stray on-load/timer/focus-triggered check a real chance to fire.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const calls = await page.evaluate('window.__fetchCalls');
  assert.deepEqual(calls, [], 'no fetch before the button is ever pressed');

  const nonFileRequests = page.requests.filter((url) => !url.startsWith('file://'));
  assert.deepEqual(nonFileRequests, [], 'no real network activity either: ' + JSON.stringify(page.requests));
});

test('pressing the button when up to date reports it in one line, with the real published version', async (t) => {
  const page = await launchPage(htmlPath, {
    initScript: fakeFetchInit(`(url) => ({ ok: true, status: 200, json: async () => ({ version: '1.3.0', download: 'https://example.test/dl' }) })`, { fakeVersion: true }),
  });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('updateCheckBtn').click()");
  await page.waitFor("document.getElementById('updateCheckResult').textContent.indexOf('latest version') !== -1");

  const text = await page.evaluate("document.getElementById('updateCheckResult').textContent");
  assert.match(text, /You're running the latest version \(1\.3\.0\)\./);
  assert.equal(await page.evaluate('window.__fetchCalls.length'), 1);
});

test('pressing the button when behind names the version and links to the download', async (t) => {
  const page = await launchPage(htmlPath, {
    initScript: fakeFetchInit(`(url) => ({ ok: true, status: 200, json: async () => ({ version: '1.4.0', download: 'https://example.test/get-the-file' }) })`, { fakeVersion: true }),
  });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('updateCheckBtn').click()");
  await page.waitFor("document.getElementById('updateCheckResult').textContent.indexOf('1.4.0') !== -1");

  const text = await page.evaluate("document.getElementById('updateCheckResult').textContent");
  assert.match(text, /Version 1\.4\.0 is out\./);
  const link = await page.evaluate(`(() => {
    const a = document.querySelector('#updateCheckResult a');
    return a ? { href: a.href, text: a.textContent } : null;
  })()`);
  assert.ok(link, 'a download link is shown');
  assert.equal(link.href, 'https://example.test/get-the-file');
  assert.match(link.text, /download/i, 'the link reads as an action');
});

test('a check that cannot reach the server answers in place with a working download link, and nothing throws', async (t) => {
  const page = await launchPage(htmlPath, {
    initScript: fakeFetchInit('async () => { throw new TypeError("Failed to fetch"); }', { fakeVersion: true }),
  });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('updateCheckBtn').click()");
  await page.waitFor("document.getElementById('updateCheckResult').textContent.indexOf('reach') !== -1");

  const text = await page.evaluate("document.getElementById('updateCheckResult').textContent");
  assert.match(text, /Couldn't reach the update server\./);
  const link = await page.evaluate(`(() => {
    const a = document.querySelector('#updateCheckResult a');
    return a ? a.href : null;
  })()`);
  assert.ok(link, 'a fallback download link is shown even when the check fails');

  assert.deepEqual(page.exceptions, [], 'nothing throws uncaught');
  assert.deepEqual(page.consoleErrors, [], 'nothing is logged where a user could see it');
});

test('the button disables itself while a check is in flight, and a second press starts no second request', async (t) => {
  let resolveFetch;
  const page = await launchPage(htmlPath, {
    initScript: fakeFetchInit(`(url) => new Promise((resolve) => { window.__resolveFetch = () => resolve({ ok: true, status: 200, json: async () => ({ version: '1.3.0', download: 'https://example.test/dl' }) }); })`, { fakeVersion: true }),
  });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('updateCheckBtn').click()");
  await page.waitFor("document.getElementById('updateCheckBtn').disabled === true");

  // A second press while the first is still in flight must not fire another request.
  await page.evaluate("document.getElementById('updateCheckBtn').click()");
  const callsDuringFlight = await page.evaluate('window.__fetchCalls.length');
  assert.equal(callsDuringFlight, 1, 'a press while disabled starts no second request');

  await page.evaluate('window.__resolveFetch()');
  await page.waitFor("document.getElementById('updateCheckBtn').disabled === false");
  assert.equal(await page.evaluate('window.__fetchCalls.length'), 1, 'still only the one request once it settles');
});

test('the answer is announced via the same status live-region convention the app already uses', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('updateCheckResult').getAttribute('role')"), 'status');
});
