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
