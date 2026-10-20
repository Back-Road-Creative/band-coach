// Acceptance: the downloaded file works when the computer is offline from the
// very first open (the network is cut over CDP BEFORE the first navigation, so
// no earlier online load can have warmed anything). Includes a negative
// control proving the hook really blocks the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { UPDATE_CHECK_OFFLINE_LOG } from '../helpers/console-allowlist.mjs';

// Only the negative control below makes these; everything before it must be clean.
const CONTROL_REQUEST = /^network request: http:\/\/example\.com\/$/;

const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };

test('opened offline from the very first load: no exceptions, picker shown, keyboard practice starts', async (t) => {
  await withAcceptancePage(t, { offlineFromStart: true, allowConsole: [CONTROL_REQUEST, UPDATE_CHECK_OFFLINE_LOG] }, async (page) => {
    await page.waitFor("document.documentElement.getAttribute('data-coach-ready') === '1'");
    assert.equal(await page.evaluate('navigator.onLine'), false, 'the browser is offline from the first load');
    assert.equal(await page.evaluate("document.querySelectorAll('#picker button[data-mod]').length > 0"), true, 'the instrument picker is shown');

    assert.deepEqual(page.requestDetails.filter((r) => !/^(file|data|blob):/.test(r.url)), [], 'boot asked the network for nothing');
    assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while booting offline');

    // Negative control: the hook really blocks the network.
    const blocked = await page.evaluate("fetch('http://example.com/', { mode: 'no-cors' }).then(() => 'reached', () => 'rejected')");
    assert.equal(blocked, 'rejected', 'a fetch to an http URL must fail while offline');

    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.querySelector('#prompt b')");
    const label = (await page.evaluate("document.getElementById('prompt').textContent.trim()")).replace(/^Play /, '');
    assert.ok(KEY_FOR[label], `a note this test can press: ${label}`);
    await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
    await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''");
    assert.deepEqual(page.exceptions, [], 'no uncaught page exceptions');
  });
});
