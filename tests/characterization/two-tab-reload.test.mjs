// Two tabs share one stored profile. When another tab writes it, this tab must
// stop saving (its copy is older), say so in plain words and offer a Reload,
// rather than silently overwriting the newer progress on its next save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SEED = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
const OTHER = '{"prefs":{"mod":"gtr"},"fromOtherTab":true}';

test('a write from another tab stops this tab saving and offers a reload', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED });
  t.after(() => page.close());
  await page.evaluate(`(() => { localStorage.setItem('bandcoach.v1', ${JSON.stringify(OTHER)}); window.dispatchEvent(new StorageEvent('storage', { key: 'bandcoach.v1', newValue: ${JSON.stringify(OTHER)}, storageArea: localStorage })); })()`);
  const say = await page.evaluate("document.getElementById('mainSay').textContent");
  assert.match(say, /another tab/i, `got: ${JSON.stringify(say)}`);
  assert.equal(await page.evaluate("document.querySelector('#mainSay button').textContent"), 'Reload');
  assert.equal(await page.evaluate("document.querySelectorAll('#settingsSay button').length"), 1);
  // A save attempt (debounced save + pagehide flush) must leave the other tab's data alone.
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  assert.equal(await page.evaluate("localStorage.getItem('bandcoach.v1')"), OTHER);
});

test('a storage event for some other key does not trigger the notice', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SEED });
  t.after(() => page.close());
  await page.evaluate("window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x', storageArea: localStorage }))");
  assert.equal(await page.evaluate("document.getElementById('mainSay').textContent"), '');
});
