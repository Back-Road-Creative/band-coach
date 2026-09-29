// This is T1 plumbing only (see the plan): src/core/model-pack.js exists and
// is unit-tested, but nothing in app.js imports or wires it up yet -- that is
// a later unit, once there is an actual model pack to offer. What this test
// proves now, the same way tests/characterization/update-check-button.test.mjs
// proves it for the update check, is the load-time half of the "zero
// requests without a press" contract: simply opening the built app makes no
// request to a model-pack URL, and no real network activity of any kind
// beyond the file:// document itself. Once a later unit wires a real button
// to loadPack(), this file is the one to extend with a same-shaped "no
// request until pressed" case (see update-check-button.test.mjs's second
// test for the pattern to follow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('loading the app makes no request to any model-pack URL and no network activity at all', async (t) => {
  const page = await launchPage(HTML_PATH, {
    initScript: `
      window.__fetchCalls = [];
      window.fetch = async (url, opts) => {
        window.__fetchCalls.push(String(url));
        throw new Error('must not be called on load');
      };
    `,
  });
  t.after(() => page.close());

  // Give any stray on-load/timer/focus-triggered fetch a real chance to fire.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const calls = await page.evaluate('window.__fetchCalls');
  const packCalls = calls.filter((url) => url.includes('model-pack'));
  assert.deepEqual(packCalls, [], 'no fetch to a model-pack URL before anything is ever pressed');

  const nonFileRequests = page.requests.filter((url) => !url.startsWith('file://'));
  assert.deepEqual(nonFileRequests, [], 'no real network activity either: ' + JSON.stringify(page.requests));
});

// ---- the "no request until pressed" half, now that a real button exists ----
import { createHash } from 'node:crypto';

const PACK_BYTES = [1, 2, 3, 4];
const PACK_SHA = createHash('sha256').update(Buffer.from(PACK_BYTES)).digest('hex');

function fakePackFetchInit({ manifestOk }) {
  return `
    window.__fetchCalls = [];
    window.fetch = async (url) => {
      url = String(url);
      window.__fetchCalls.push(url);
      if (url.endsWith('manifest.json')) {
        if (!${manifestOk}) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
        return { ok: true, json: async () => ({ name: 'core', version: '1.0.0', bytes: 4, sha256: '${PACK_SHA}', url: 'https://example.test/model-packs/core/pack.bin' }) };
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array(${JSON.stringify(PACK_BYTES)}).buffer };
    };
  `;
}

const status = (page) => page.evaluate("document.getElementById('modelPackStatus').textContent");

test('the Settings button explains the pack and nothing is fetched until it is pressed', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakePackFetchInit({ manifestOk: true }) });
  t.after(() => page.close());
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.match(await page.evaluate("document.getElementById('modelPackHelp').textContent"), /optional/i);
  await page.waitFor("document.getElementById('modelPackStatus').textContent !== ''");
  assert.match(await status(page), /not downloaded/i);
  assert.deepEqual(await page.evaluate('window.__fetchCalls'), [], 'no request before the press');

  await page.evaluate("document.getElementById('modelPackBtn').click()");
  await page.waitFor("/downloaded/i.test(document.getElementById('modelPackStatus').textContent) && !/not downloaded/i.test(document.getElementById('modelPackStatus').textContent)");
  const calls = await page.evaluate('window.__fetchCalls');
  assert.equal(calls.length, 2, 'exactly the manifest and the pack file: ' + JSON.stringify(calls));
  assert.match(await status(page), /1\.0\.0/);
});

test('a downloaded pack survives a reload (persisted in IndexedDB) and reload alone makes no request', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakePackFetchInit({ manifestOk: true }) });
  t.after(() => page.close());
  await page.evaluate("document.getElementById('modelPackBtn').click()");
  await page.waitFor("/1\\.0\\.0/.test(document.getElementById('modelPackStatus').textContent)");

  await page.reload();
  await page.waitFor("/1\\.0\\.0/.test(document.getElementById('modelPackStatus').textContent)");
  assert.deepEqual(await page.evaluate('window.__fetchCalls'), [], 'the cached state is read locally, no request');
});

test('a 404 manifest says no model pack is published yet and caches nothing', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: fakePackFetchInit({ manifestOk: false }) });
  t.after(() => page.close());
  await page.evaluate("document.getElementById('modelPackBtn').click()");
  await page.waitFor("/no model pack is published yet/i.test(document.getElementById('modelPackStatus').textContent)");
  assert.equal(await page.evaluate("document.getElementById('modelPackBtn').disabled"), false, 'can try again');

  await page.reload();
  await page.waitFor("document.getElementById('modelPackStatus').textContent !== ''");
  assert.match(await status(page), /not downloaded/i, 'nothing was cached');
});
