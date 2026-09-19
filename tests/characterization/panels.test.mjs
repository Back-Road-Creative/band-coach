// The feature-panel frame (src/ui/panels.js wired in app.js): a registered
// panel gets a button, opening it swaps the trainer out, and picking an
// instrument swaps it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('a registered panel opens in place of the trainer and an instrument closes it', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.registerPanel({ id: 'demo', name: 'Demo', tag: 'test',
    mount: el => { el.innerHTML = '<p id="demoBody">hello</p>'; window.__demoShown = 0; return { show: () => window.__demoShown++ }; } })`);
  assert.equal(await page.evaluate("document.getElementById('panelPicker').hidden"), false);
  await page.evaluate("document.querySelector('#panelPicker button[data-panel=\"demo\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'demo');
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('demoBody').textContent"), 'hello');
  assert.equal(await page.evaluate('window.__demoShown'), 1);

  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null);
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('panelHost').hidden"), true);
});
