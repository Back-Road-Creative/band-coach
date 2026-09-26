// P7-4 "journey acceptance" (plan §1 P7-4): a returning learner can reach
// every one of the five nav destinations -- Practice, Songs, Progress,
// Instrument, Settings -- with the keyboard alone, in the order the nav bar
// shows them, using real Tab/Enter (and Space) presses over launchPage's
// press() -- no `.click()` on the learner path (plan §2 "Do not").
//
// F2 (plan §0.6): buildNav()'s click handler (src/app.js, `b.blur()` before
// routeTo()) used to drop focus to <body> on every nav activation. §5 of
// the plan file says focus should move to the new destination's heading --
// this test now asserts that fixed behaviour: activating a nav button that
// actually changes screen moves focus onto that destination's own heading,
// never <body>. Re-pressing the destination already showing (Practice at
// boot, and the Instrument sheet's own close-on-second-press) is a no-op
// per routeTo()'s own guard, so those two leave focus exactly where it
// already was -- on the nav button just pressed -- instead of moving it
// anywhere.
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

// True once document.activeElement is a heading (h1-h6) inside
// `containerSelector` -- how this file tells "focus landed on the
// destination's own heading" apart from <body> or from the heading of a
// DIFFERENT screen that happens to still be in the DOM but hidden.
async function focusedHeadingIn(page, containerSelector) {
  return page.evaluate(
    `(() => { const el = document.activeElement, c = document.querySelector(${JSON.stringify(containerSelector)}); return !!el && /^H[1-6]$/.test(el.tagName) && !!c && c.contains(el); })()`
  );
}

async function activeElementIs(page, selector) {
  return page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
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
  // F2: re-pressing the already-current destination is a no-op in routeTo()
  // (the guard above this stop's own comment describes), so focus stays
  // exactly where the Enter press left it -- on the Practice nav button --
  // instead of moving to a heading or dropping to <body>.
  assert.equal(await activeElementIs(page, '#mainNav button[data-route="practice"]'), true, 'F2: re-pressing current Practice is a no-op, so focus stays on the Practice nav button, not <body>');

  // Stop 2: Songs.
  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page', 'Songs: aria-current moves to Songs');
  assert.equal(await focusedHeadingIn(page, '#panelHost'), true, 'F2: focus moves to the Songs panel heading, not <body>');

  // Stop 3: Progress.
  await tabTo(page, '#mainNav button[data-route="progress"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').getAttribute('aria-current')"), 'page', 'Progress: aria-current moves to Progress');
  assert.equal(await focusedHeadingIn(page, '#panelHost'), true, 'F2: focus moves to the Progress panel heading, not <body>');

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
  assert.equal(await focusedHeadingIn(page, '#picker'), true, 'F2: focus moves to the Instrument sheet heading, not <body>');

  // Instrument again: pressing it a second time is the sheet's own
  // no-op-shaped case -- it closes instead of opening, and focus returns to
  // the nav button that opened it (the heading it was just on is now
  // hidden), not to <body>.
  await tabTo(page, '#navInstrument');
  await page.press('Enter');
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'Instrument: pressing it again closes the sheet');
  assert.equal(await activeElementIs(page, '#navInstrument'), true, 'F2: focus returns to the Instrument nav button once the sheet closes');

  // Stop 5: Settings.
  await tabTo(page, '#mainNav button[data-route="settings"]');
  await page.press('Enter');
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), false, 'Settings: #settingsView is shown');
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current')"), 'page', 'Settings: aria-current moves to Settings');
  assert.equal(await focusedHeadingIn(page, '#settingsView'), true, 'F2: focus moves to the Settings heading, not <body>');
});

test('Space activates a nav button the same as Enter', async (t) => {
  const page = await launchPage(htmlPath, { initScript: RETURNING_LEARNER_INIT });
  t.after(() => page.close());

  await tabTo(page, '#mainNav button[data-route="songs"]');
  await page.press(' ');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"), 'page', 'Space on Songs opens Songs and marks it current, same as Enter');
  // F2 again: Space activation goes through the same click handler as Enter,
  // so it moves focus to the Songs heading too, not <body>.
  assert.equal(await focusedHeadingIn(page, '#panelHost'), true, 'F2: focus moves to the Songs panel heading after Space-activating Songs, same as Enter');
});
