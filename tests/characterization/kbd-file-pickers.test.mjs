// The two file pickers -- Settings' "Restore a backup" and Play along's
// "Open a recording" -- are a <label> for a `hidden` file input, so before
// this fix a real Tab walk passed straight over them: no keyboard or
// screen-reader user could restore a backup (WCAG 2.1.1; found by the E9
// agent-led qualification, docs/release-acceptance-record.md). Each picker
// must be a Tab stop with a button role and its visible name, and Enter or
// Space on it must open the browser's file chooser, as a click does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function tabTo(page, forId, max = 80) {
  await page.evaluate('document.activeElement && document.activeElement.blur(); scrollTo(0, 0)');
  for (let i = 0; i < max; i++) {
    await page.press('Tab');
    if (await page.evaluate(`document.activeElement.matches('label[for="${forId}"]')`)) return true;
  }
  return false;
}

async function chooserOpensOn(page, key) {
  let off = () => {};
  const opened = new Promise((res) => { off = page.cdp.on((m) => { if (m.method === 'Page.fileChooserOpened') res(true); }); });
  await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
  await page.press(key);
  const got = await Promise.race([opened, new Promise((res) => setTimeout(() => res(false), 3000))]);
  off();
  await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
  return got;
}

const PICKERS = [
  { name: 'Restore a backup', forId: 'backupRestoreInput', open: "document.querySelector('#mainNav button[data-route=\"settings\"]').click()", ready: "document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current') === 'page'" },
  { name: 'Open a recording', forId: 'paFileInput', open: "window.__coach.openPanel('playalong')", ready: "!!document.getElementById('paFileInput')" },
];

for (const p of PICKERS) {
  for (const key of ['Enter', ' ']) {
    test(`"${p.name}" is a Tab stop named as a button, and ${key === ' ' ? 'Space' : 'Enter'} opens the file chooser`, async (t) => {
      const page = await launchPage(HTML_PATH);
      t.after(() => page.close());
      await page.setViewport({ width: 1280, height: 800 });
      await page.evaluate(p.open);
      await page.waitFor(p.ready);
      assert.ok(await tabTo(page, p.forId), `Tab never reached "${p.name}"`);
      await page.cdp.send('Accessibility.enable', {});
      const { nodes } = await page.cdp.send('Accessibility.getPartialAXTree', { backendNodeId: (await page.cdp.send('DOM.describeNode', { objectId: (await page.cdp.send('Runtime.evaluate', { expression: 'document.activeElement' })).result.objectId })).node.backendNodeId, fetchRelatives: false });
      assert.equal(nodes[0].role.value, 'button');
      assert.equal(nodes[0].name.value, p.name);
      assert.equal(await chooserOpensOn(page, key), true, `${key === ' ' ? 'Space' : 'Enter'} on "${p.name}" opened no file chooser`);
      assert.deepEqual(page.exceptions, []);
    });
  }
}
