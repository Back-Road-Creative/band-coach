// P7-4 "journey acceptance" (plan §1 P7-4): a returning learner can reach
// every one of the five nav destinations -- Practice, Songs, Progress,
// Instrument, Settings -- with the keyboard alone, in the order the nav bar
// shows them, using real Tab/Enter (and Space) presses over launchPage's
// press() -- no `.click()` on the learner path (plan §2 "Do not").
//
// F2 (plan §0.6): buildNav()'s click handler (src/app.js, `b.blur()` before
// routeTo()) drops focus to <body> on every nav activation. §5 of the plan
// file says focus should move to the new destination's heading -- it does
// not today (only editor/playalong do that, per songs-internal-screens).
// This test RECORDS that current behaviour (document.activeElement is
// <body> after each activation) as a plain fact, so that fixing F2 later is
// a one-line change to that one assertion -- it does NOT assert the §5 rule
// itself, per plan §2 ("do not assert §5 behaviour the app does not have").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { tabTo } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;

// A returning learner (saved instrument) meets the picker sheet already
// shut, the same seed journey-first-visit.test.mjs:119 uses -- this is what
// lets the Instrument stop below prove the sheet OPENING (hidden: true ->
// false) rather than a first-time visitor's sheet merely toggling shut.
const RETURNING_LEARNER_INIT = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";

async function activeElementIsBody(page) {
  return page.evaluate('document.activeElement === document.body');
}

test('every destination is reachable with Tab and Enter', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());

  // Boot: Practice is current and #mainArea is showing, per nav-shell.test.mjs.
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page', 'Practice starts current');

  // Stop 1: Practice (re-activating the already-current destination is a
  // no-op in routeTo(), per app.js's own guard -- it must stay a no-op, not
  // an error, when reached this way).
  await tabTo(page, '#mainNav button[data-route="practice"]');
  await page.press('Enter');
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), false, 'Practice: #mainArea is shown');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page', 'Practice: aria-current stays on Practice');
  // F2: activating a nav button drops focus to <body>, not to a destination
  // heading -- current behaviour, not the §5 rule.
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after activating Practice, not on a destination heading');

  // Stop 2: Songs.
  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page', 'Songs: aria-current moves to Songs');
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after activating Songs');

  // Stop 3: Progress.
  await tabTo(page, '#mainNav button[data-route="progress"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').getAttribute('aria-current')"), 'page', 'Progress: aria-current moves to Progress');
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after activating Progress');

  // Stop 4: Instrument. Unlike the other four, Instrument never claims
  // aria-current (app.js's navDestFor/updateNavState don't know it exists)
  // -- it only opens the chooser sheet, leaving Progress current underneath
  // it, exactly as nav-shell.test.mjs proves for Songs.
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'Instrument: the sheet starts shut for a returning learner');
  await tabTo(page, '#navInstrument');
  await page.press('Enter');
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'Instrument: the sheet is now open');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"instrument\"]').getAttribute('aria-current')"), null, 'Instrument: never claims aria-current');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').getAttribute('aria-current')"), 'page', 'Instrument: Progress stays current underneath the sheet');
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after activating Instrument');

  // Stop 5: Settings.
  await tabTo(page, '#mainNav button[data-route="settings"]');
  await page.press('Enter');
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), false, 'Settings: #settingsView is shown');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current')"), 'page', 'Settings: aria-current moves to Settings');
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after activating Settings');
});

test('Space activates a nav button the same as Enter', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());

  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press(' ');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page', 'Space on Songs opens Songs and marks it current, same as Enter');
  // F2 again: Space activation goes through the same click handler as Enter,
  // so it drops focus to <body> too.
  assert.equal(await activeElementIsBody(page), true, 'F2: focus lands on <body> after Space-activating Songs, same as Enter');
});
