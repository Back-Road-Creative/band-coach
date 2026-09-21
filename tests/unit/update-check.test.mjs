// A downloaded band-coach.html runs from file:// and can never rewrite or
// replace itself -- that is a browser security boundary, not a missing
// feature -- so the honest alternative is telling the user it is out of
// date, with a one-click path to the current copy. This is the pure seam:
// version comparison and the fetch policy, with no DOM and no real network,
// so every branch (up to date, behind, every flavour of "couldn't reach",
// and the dev-build no-request rule) is provable without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, compareVersions, parseVersion, VERSION_CHECK_URL, FALLBACK_DOWNLOAD_URL, CHECK_TIMEOUT_MS } from '../../src/core/update-check.js';
import { DEV_VERSION } from '../../src/core/version.js';

test('compareVersions compares numerically per component, not as strings', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1, '1.10.0 is newer than 1.9.0 numerically');
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
});

test('compareVersions returns null (never a guess) for an unparseable version on either side', () => {
  assert.equal(compareVersions('not-a-version', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', 'not-a-version'), null);
  assert.equal(compareVersions('', ''), null);
});

test('parseVersion accepts a leading semver triple and rejects garbage', () => {
  assert.deepEqual(parseVersion('1.3.0'), [1, 3, 0]);
  assert.equal(parseVersion('vNext'), null);
  assert.equal(parseVersion(undefined), null);
});

test('a dev build never makes a network request and is reported as its own state', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('should never be called'); };
  const result = await checkForUpdate({ currentVersion: DEV_VERSION, fetchImpl });
  assert.equal(result.status, 'dev');
  assert.equal(called, false, 'no fetch for a dev build');
});

test('reports up to date when the published version matches', async () => {
  const fetchImpl = async () => okResponse({ version: '1.3.0', released: '2026-01-01', download: 'https://example.test/dl' });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'up-to-date');
  assert.equal(result.latestVersion, '1.3.0');
});

test('a local version newer than the published one is up to date, never "behind"', async () => {
  const fetchImpl = async () => okResponse({ version: '1.3.0', download: 'https://example.test/dl' });
  const result = await checkForUpdate({ currentVersion: '1.4.0', fetchImpl });
  assert.equal(result.status, 'up-to-date');
});

test('reports "behind" with the published version number and its download link', async () => {
  const fetchImpl = async () => okResponse({ version: '1.4.0', download: 'https://example.test/get-the-file' });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'behind');
  assert.equal(result.latestVersion, '1.4.0');
  assert.equal(result.downloadUrl, 'https://example.test/get-the-file');
});

test('a network rejection is reported as "couldn\'t reach", with the fallback link, never thrown', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'error');
  assert.equal(result.downloadUrl, FALLBACK_DOWNLOAD_URL);
});

test('a non-200 response is "couldn\'t reach"', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ version: '1.4.0' }) });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'error');
});

test('malformed JSON is "couldn\'t reach"', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'error');
});

test('JSON missing the version key is "couldn\'t reach"', async () => {
  const fetchImpl = async () => okResponse({ released: '2026-01-01', download: 'https://example.test/dl' });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'error');
});

test('an unparseable published version is "couldn\'t reach", never "behind"', async () => {
  const fetchImpl = async () => okResponse({ version: 'vNext', download: 'https://example.test/dl' });
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl });
  assert.equal(result.status, 'error');
});

test('an unparseable local version is "couldn\'t reach", never a guess', async () => {
  const fetchImpl = async () => okResponse({ version: '1.4.0', download: 'https://example.test/dl' });
  const result = await checkForUpdate({ currentVersion: 'not-a-real-version', fetchImpl });
  assert.equal(result.status, 'error');
});

test('a request that outlives the timeout is "couldn\'t reach", not a hang', async () => {
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const start = Date.now();
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl, timeoutMs: 20 });
  assert.equal(result.status, 'error');
  assert.ok(Date.now() - start < 2000, 'did not wait for the real 5s default timeout');
});

test('a missing fetch implementation (no global fetch at all) is "couldn\'t reach", not a throw', async () => {
  const result = await checkForUpdate({ currentVersion: '1.3.0', fetchImpl: undefined });
  assert.equal(result.status, 'error');
  assert.equal(result.downloadUrl, FALLBACK_DOWNLOAD_URL);
});

test('the default timeout is around 5 seconds, as the product spec calls for', () => {
  assert.equal(CHECK_TIMEOUT_MS, 5000);
});

test('the version URL is the published GitHub Pages endpoint', () => {
  assert.equal(VERSION_CHECK_URL, 'https://back-road-creative.github.io/band-coach/version.json');
});

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}
