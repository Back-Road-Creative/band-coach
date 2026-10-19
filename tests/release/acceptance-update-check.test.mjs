// "Check for updates" on the file a person downloads: it says the right thing in
// each case, and only when asked. The published version.json is answered by the
// test through the browser's own request interception (Fetch.requestPaused), so
// the page's real fetch() runs; the button is a real click on the Settings
// screen. Expected wording is read from the i18n table, never copied here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withAcceptancePage, launchPage } from '../helpers/browser.mjs';
import { UPDATE_CHECK_REQUEST, UPDATE_CHECK_OFFLINE_LOG } from '../helpers/console-allowlist.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { stubRequests } from '../helpers/cdp-extras.mjs';
import { en, t } from '../../src/core/i18n.js';
import { VERSION_CHECK_URL, FALLBACK_DOWNLOAD_URL } from '../../src/core/update-check.js';
import { DEV_VERSION } from '../../src/core/version.js';

const RELEASE_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const SAFE_DOWNLOAD = 'https://github.com/Back-Road-Creative/band-coach/releases/download/v99.0.0/band-coach.html';

async function press(page) {
  await page.clickSelector('#mainNav button[data-route="settings"]');
  await page.clickSelector('#updateCheckBtn');
}
const result = (page) => page.evaluate("(() => { const r = document.getElementById('updateCheckResult'); const a = r.querySelector('a'); return { text: r.textContent, link: a ? { href: a.href, text: a.textContent } : null }; })()");
const settled = (page) => page.waitFor("!document.getElementById('updateCheckBtn').disabled && document.getElementById('updateCheckResult').textContent !== '' && document.getElementById('updateCheckResult').textContent !== " + JSON.stringify(t('update.checking')));

test('release file, version.json names this very version: says it is the latest', async (t_) => {
  await withAcceptancePage(t_, { allowConsole: [UPDATE_CHECK_REQUEST] }, async (page) => {
    const stub = await stubRequests(page, VERSION_CHECK_URL, () => ({ body: { version: RELEASE_VERSION, released: '2026-01-01T00:00:00Z', download: SAFE_DOWNLOAD } }));
    await press(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.text, t('update.upToDate', { version: RELEASE_VERSION }));
    assert.equal(r.link, null, 'nothing to download when already current');
    assert.deepEqual(stub.seen, [VERSION_CHECK_URL]);
  });
});

test('release file, version.json names a newer version: says so and links the safe download', async (t_) => {
  await withAcceptancePage(t_, { allowConsole: [UPDATE_CHECK_REQUEST] }, async (page) => {
    await stubRequests(page, VERSION_CHECK_URL, () => ({ body: { version: '99.0.0', download: SAFE_DOWNLOAD } }));
    await press(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.text, t('update.behind', { version: '99.0.0' }) + t('update.downloadLinkText'));
    assert.deepEqual(r.link, { href: SAFE_DOWNLOAD, text: t('update.downloadLinkText') });
  });
});

test('release file, newer version but an untrusted download link: links the known-good release file instead', async (t_) => {
  await withAcceptancePage(t_, { allowConsole: [UPDATE_CHECK_REQUEST] }, async (page) => {
    await stubRequests(page, VERSION_CHECK_URL, () => ({ body: { version: '99.0.0', download: 'https://evil.example/band-coach.html' } }));
    await press(page);
    await settled(page);
    assert.equal((await result(page)).link.href, FALLBACK_DOWNLOAD_URL);
  });
});

test('release file, the request fails: says it could not reach the server and still offers the download', async (t_) => {
  await withAcceptancePage(t_, { allowConsole: [UPDATE_CHECK_REQUEST, UPDATE_CHECK_OFFLINE_LOG] }, async (page) => {
    await stubRequests(page, VERSION_CHECK_URL, () => ({ fail: 'InternetDisconnected' }));
    await press(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.text, t('update.error') + t('update.downloadLinkText'));
    assert.equal(r.link.href, FALLBACK_DOWNLOAD_URL);
  });
});

// The acceptance lane refuses the dev build on purpose, so this one case uses the
// plain launcher on dist/band-coach.html (the file README step 6 warns about).
test('development build (README step 6): says so and makes no request', async () => {
  const page = await launchPage(HTML_PATH);
  try {
    const stub = await stubRequests(page, VERSION_CHECK_URL, () => ({ body: { version: RELEASE_VERSION } }));
    await press(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.text, t('update.devBuild', { version: DEV_VERSION }));
    assert.equal(r.link, null);
    assert.deepEqual(stub.seen, [], 'a dev build must not ask the network');
  } finally {
    await page.close();
  }
});

test('the i18n keys these tests rely on exist in English', () => {
  for (const k of ['update.upToDate', 'update.behind', 'update.error', 'update.devBuild', 'update.downloadLinkText']) assert.ok(en[k], k);
});
