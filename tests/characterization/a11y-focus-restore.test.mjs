// panels.js's close() used to remove the open panel's container without
// giving focus anywhere else first (src/ui/panels.js). One real path that
// closes a panel this way is picking a different instrument from the
// Instrument sheet while a panel is open: buildPanelToolButton/
// buildPickerButton (src/app.js) both call button.blur() on the clicked
// picker button BEFORE closePanel() -- so by the time panels.close() ran,
// focus had already been dropped to <body>, and closing the panel left it
// there, not on anything a keyboard user could pick up Tab from.
//
// Escape now also closes a panels.js-managed panel (its own Escape-to-close
// path, not createFocusTrap's -- see tests/characterization/a11y-panel-escape.test.mjs
// and src/ui/panels.js). Both cases below still use a different real trigger
// (choosing an instrument from the sheet) against two different panels,
// since that path exercises panels.js's close() through a route Escape does
// not: focus already moved somewhere OUTSIDE the panel (the just-clicked
// picker button) before close() runs, rather than Escape's own case of
// focus still being inside the panel when it closes.
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

async function openPanelThenSwitchInstrument(page, navRoute) {
  await tabTo(page, `#mainNav button[data-route="${navRoute}"]`);
  await page.press('Enter');
  await tabTo(page, '#navInstrument');
  await page.press('Enter');
  await tabTo(page, '#picker button[data-mod="bass"]');
  await page.press('Enter');
}

test('closing the Songs panel by picking a new instrument gives focus back to the Songs nav button, not <body>', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await openPanelThenSwitchInstrument(page, 'songs');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null, 'the Songs panel is closed once a new instrument is chosen');
  assert.equal(await activeElementIs(page, 'body'), false, 'focus did not fall through to <body>');
  assert.equal(await activeElementIs(page, '#mainNav button[data-route="songs"]'), true, 'focus returned to the Songs nav button that opened the panel');
});

test('closing the Progress panel by picking a new instrument gives focus back to the Progress nav button, not <body>', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());
  await page.waitFor("window.__coach.panelOpen() === null");
  await openPanelThenSwitchInstrument(page, 'progress');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), null, 'the Progress panel is closed once a new instrument is chosen');
  assert.equal(await activeElementIs(page, 'body'), false, 'focus did not fall through to <body>');
  assert.equal(await activeElementIs(page, '#mainNav button[data-route="progress"]'), true, 'focus returned to the Progress nav button that opened the panel');
});
