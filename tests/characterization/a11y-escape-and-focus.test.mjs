// Escape must take the learner back to a normal Practice screen (not an empty
// page under the nav), the instrument sheet must close on Escape, and opening
// a tool panel or choosing an instrument by keyboard must leave focus on a
// real control/heading rather than dropping to <body>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { tabTo } from '../helpers/journey.mjs';

const RETURNING_LEARNER_INIT = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
const shown = (page, sel) => page.evaluate(`!document.querySelector(${JSON.stringify(sel)}).hidden`);
const activeDesc = page => page.evaluate("document.activeElement.tagName + '#' + document.activeElement.id");

test('Escape in Songs restores the Practice screen and the Practice nav button works', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press('Enter');
  await page.press('Tab');
  await page.press('Escape');
  assert.equal(await shown(page, '#mainArea'), true, 'the Practice screen is visible again');
  assert.equal(await shown(page, '#panelHost'), false, 'the empty panel host is hidden');
  assert.equal(await page.evaluate("document.querySelector('#mainNav [aria-current]').dataset.route"), 'practice', 'the nav marks Practice current');
});

test('Escape in a tool panel opened from the sheet restores Practice and focus is never on <body>', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await tabTo(page, '#navInstrument');
  await page.press('Enter');
  await tabTo(page, '#picker button[data-panel="theory"]');
  await page.press('Enter');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'theory');
  assert.equal(await page.evaluate("!!document.activeElement.closest('#panelHost') && /^H[1-6]$/.test(document.activeElement.tagName)"), true, 'focus lands on a heading inside the panel');
  await page.press('Escape');
  assert.equal(await shown(page, '#mainArea'), true, 'the Practice screen is visible again');
  assert.equal(await shown(page, '#panelHost'), false, 'the panel host is hidden');
  assert.notEqual(await activeDesc(page), 'BODY#', 'focus did not fall to <body>');
});

test('Escape closes the instrument sheet, and choosing an instrument keeps focus on the nav Instrument button', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await tabTo(page, '#navInstrument');
  await page.press('Enter');
  assert.equal(await shown(page, '#picker'), true, 'the sheet opened');
  await page.press('Escape');
  assert.equal(await shown(page, '#picker'), false, 'Escape closed the sheet');
  assert.equal(await activeDesc(page), 'BUTTON#navInstrument', 'focus is back on the nav Instrument button');
  await page.press('Enter');
  await tabTo(page, '#picker button[data-mod="kbd"]');
  await page.press('Enter');
  assert.equal(await shown(page, '#picker'), false, 'choosing closed the sheet');
  assert.equal(await activeDesc(page), 'BUTTON#navInstrument', 'focus is on the nav Instrument button, not <body>');
});
