// New behaviour (unit 7.7 item 5): the break card is role="dialog" and must
// move focus in when it opens, trap Tab inside itself, close on Escape, and
// give focus back to whatever had it before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function pressKey(page, target, key, opts = {}) {
  await page.evaluate(`
    document.getElementById(${JSON.stringify(target)}).dispatchEvent(
      new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${!!opts.shiftKey}, bubbles: true, cancelable: true })
    )
  `);
}

test('opening the break card moves focus inside it and closing restores focus', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').focus()");
  await page.evaluate("document.getElementById('playBtn').click()"); // start
  await page.waitFor('window.__coach.task()');
  await page.evaluate("document.getElementById('playBtn').click()"); // user-initiated break

  await page.waitFor("document.getElementById('breakCard').hidden === false");
  const activeInsideDialog = await page.evaluate(
    "document.getElementById('breakCard').contains(document.activeElement)"
  );
  assert.equal(activeInsideDialog, true, 'focus should move inside the dialog when it opens');
  assert.equal(await page.evaluate('document.activeElement.id'), 'backBtn');

  await pressKey(page, 'breakCard', 'Escape');
  await page.waitFor("document.getElementById('breakCard').hidden === true");
  assert.equal(await page.evaluate('document.activeElement.id'), 'playBtn', 'focus restored to what opened the dialog');
});

test('Tab is trapped inside the open break card and wraps at both ends', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("document.getElementById('breakCard').hidden === false");

  assert.equal(await page.evaluate('document.activeElement.id'), 'backBtn');
  await pressKey(page, 'breakCard', 'Tab');
  assert.equal(await page.evaluate('document.activeElement.id'), 'endBtn2', 'Tab moves to the next focusable in the dialog');
  await pressKey(page, 'breakCard', 'Tab');
  assert.equal(await page.evaluate('document.activeElement.id'), 'backBtn', 'Tab wraps back to the first focusable');
  await pressKey(page, 'breakCard', 'Tab', { shiftKey: true });
  assert.equal(await page.evaluate('document.activeElement.id'), 'endBtn2', 'Shift+Tab wraps to the last focusable');
});
