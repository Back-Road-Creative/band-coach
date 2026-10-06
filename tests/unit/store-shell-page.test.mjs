// Rendered check for the Store shell: the real store/preload.js runs in the
// real built page, and the two web-only settings groups (update check, model
// pack) must be display:none there while every other group stays visible. The
// text-level check in store-shell-hardening.test.mjs cannot see markup moving
// a button out of its .settings-group or another rule overriding the display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const preloadSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'store', 'preload.js'), 'utf8');
const GROUPS = `(() => { const d = {}; for (const id of ['updateCheckBtn', 'modelPackBtn', 'resetBtn']) { const g = document.getElementById(id).closest('.settings-group'); d[id] = g ? getComputedStyle(g).display : 'no-group'; } return d; })()`;

test('in the Store shell the update-check and model-pack groups are not displayed, the rest are', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: `(function(){ ${preloadSrc} })();` });
  t.after(() => page.close());
  assert.equal(await page.evaluate("document.documentElement.getAttribute('data-shell')"), 'store');
  const d = await page.evaluate(GROUPS);
  assert.equal(d.updateCheckBtn, 'none', 'update-check group');
  assert.equal(d.modelPackBtn, 'none', 'model-pack group');
  assert.notEqual(d.resetBtn, 'none', 'other settings groups stay visible');
});

test('in a browser (no preload) both web-only groups are still displayed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  assert.equal(await page.evaluate("document.documentElement.hasAttribute('data-shell')"), false);
  const d = await page.evaluate(GROUPS);
  assert.notEqual(d.updateCheckBtn, 'none');
  assert.notEqual(d.modelPackBtn, 'none');
});
