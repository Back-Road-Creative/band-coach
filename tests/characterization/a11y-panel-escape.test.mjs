// panels.js's close() already restores focus to whatever opened a panel
// (src/ui/panels.js, and see tests/characterization/a11y-focus-restore.test.mjs),
// but until now the ONLY way to trigger that close path was a click/Enter on
// a nav button or picker row -- there was no way to dismiss an open panel
// from the keyboard alone without tabbing all the way to one of those
// controls. WCAG 2.1.2/2.4.3 expects a dismissible panel to close on Escape
// from wherever focus happens to be inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { tabTo } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;
const RETURNING_LEARNER_INIT = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";

async function activeElementIs(page, selector) {
  return page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
}

test('Escape closes an open panel from a control inside it and returns focus to the nav button that opened it', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press('Enter');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'the Songs panel opened');
  // Move focus onto whatever is first inside the panel -- Escape must close
  // the panel from in here, not just from the nav button itself.
  await page.press('Tab');
  assert.equal(await activeElementIs(page, '#mainNav button[data-route="songs"]'), false, 'focus moved off the nav button and into the panel');
  await page.press('Escape');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null, 'Escape closed the open panel');
  assert.equal(await activeElementIs(page, '#mainNav button[data-route="songs"]'), true, 'focus returned to the Songs nav button that opened the panel');
});

test('Escape with no panel open does nothing harmful', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await page.press('Escape');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null, 'still no panel open');
});
