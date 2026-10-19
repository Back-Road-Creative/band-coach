// Acceptance: the release file works with no network at all. The browser is put
// offline (Network.emulateNetworkConditions) and the page reloaded, so the boot
// under test is an offline one; every request of the whole run, first boot
// included, is recorded and only file:, data: and blob: may appear. Then the
// learner chooses an instrument, presses Start, plays prompted notes with real
// key presses, ends, opens Progress, and Saves a backup (a real download).
// The app's update check is on request only, so nothing here may ask for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { captureDownloads } from '../helpers/cdp-extras.mjs';

const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j', 'C (high)': 'k' };
const ALLOWED = /^(file|data|blob):/;
const text = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const go = (page, route) => page.clickSelector(`#mainNav button[data-route="${route}"]`);

test('with the network off, choose, Start, play, Progress and Save a backup all work and nothing asks the network', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-offline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await withAcceptancePage(t, {}, async (page) => {
    await page.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.reload();
    await page.waitFor("document.documentElement.getAttribute('data-coach-ready') === '1'");
    assert.equal(await page.evaluate('navigator.onLine'), false, 'the browser is offline for this run');

    // A reload remembers the first boot's instrument and folds the picker away; "Choose an instrument" opens it again.
    if (await page.evaluate("document.getElementById('picker').getBoundingClientRect().height === 0")) await page.clickSelector('#navInstrument');
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.clickSelector('#playBtn');
    for (let i = 0; i < 3; i++) {
      await page.waitFor("document.querySelector('#prompt b')");
      const label = (await text(page, 'prompt')).replace(/^Play /, '');
      assert.ok(KEY_FOR[label], `a note this test can press: ${label}`);
      await page.evaluate("document.getElementById('feedback').textContent = ''");
      await page.press(KEY_FOR[label], { text: KEY_FOR[label] });
      await page.waitFor("document.getElementById('feedback').textContent.trim() !== ''");
    }
    await page.clickSelector('#endBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Start'");

    await go(page, 'progress');
    await page.waitFor("!document.getElementById('panelHost').hidden");
    const waitForDownload = await captureDownloads(page, dir);
    await go(page, 'settings');
    await page.clickSelector('#backupSaveBtn');
    const saved = await waitForDownload('band-coach-progress.json');
    assert.ok(JSON.parse(saved.text), 'the saved backup is readable JSON');

    const outside = page.requestDetails.filter((r) => !ALLOWED.test(r.url));
    assert.deepEqual(outside, [], `requests that are not file:, data: or blob: (${page.requestDetails.length} in all)`);
    assert.deepEqual(page.exceptions, [], 'no page exceptions');
  });
});
