// P7 "journey acceptance" (plan §6 P2 Acceptance): a first-time visitor can
// reach the first exercise with a keyboard alone -- no mouse, no `.click()`
// anywhere on the journey path -- and Start is always somewhere a phone
// screen actually shows without scrolling. axe-core confirms the app stays
// WCAG-clean at each stopping point along the way, and a returning learner
// (saved instrument) is proven to reach Start with less Tab travel than a
// first-time visitor, because the instrument sheet starts shut for them.
//
// "Input ready" here is the app's OWN behaviour, not an assumption: reading
// #playBtn's click handler (src/app.js) shows it calls startSession()
// unconditionally -- there is no microphone gate to satisfy -- so a
// headless run with no real mic reaches the first exercise exactly the way
// a learner who has not yet plugged in a mic or MIDI device would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { axeSource, scan, tabTo, rectOf, assertInFirstScreen } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;

test('first visit: keyboard alone reaches the first exercise, Start stays in the first phone screen, and every stopping point is axe-clean', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport({ width: 390, height: 844, mobile: true });
  await page.evaluate(axeSource);

  // Fresh first paint: no saved profile, so the instrument sheet is open.
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'a first-time visitor meets the instrument sheet open');
  assertInFirstScreen(await rectOf(page, '#playBtn'), 844, 'fresh first paint');
  assert.equal(await page.evaluate('window.scrollY'), 0, 'fresh first paint should not start pre-scrolled');
  await scan(page, 'fresh first paint (instrument sheet open)');

  // Choose an instrument by keyboard alone -- Tab to the real picker
  // button, Enter to activate it (the button's own click listener runs,
  // exactly as buildPickerButton() wires it in src/app.js).
  await tabTo(page, '#picker button[data-mod="kbd"]');
  await page.press('Enter');
  await page.waitFor("document.getElementById('picker').hidden === true");
  assert.match(await page.evaluate("document.getElementById('navInstrument').textContent"), /keyboard/i, 'the nav button now names the chosen instrument');

  assertInFirstScreen(await rectOf(page, '#playBtn'), 844, 'after choosing an instrument');
  assert.equal(await page.evaluate('window.scrollY'), 0, 'choosing an instrument should not itself scroll the page');
  await scan(page, 'instrument chosen, sheet shut');

  // Reach and activate Start by keyboard alone. No mic is available in this
  // headless run and #playBtn's handler (src/app.js) calls startSession()
  // with no input gate, so this proves the same "reaches the first
  // exercise" path a mic-less first-time visitor takes.
  await tabTo(page, '#playBtn');
  await page.press('Enter');
  await page.waitFor('window.__coach.task()');
  assert.ok(await page.evaluate('window.__coach.task()'), 'the first exercise is live');

  await scan(page, 'first exercise running');
});

test('a returning learner (saved instrument) reaches Start with fewer Tab stops than a first visit, and the nav Instrument button still names the instrument', async (t) => {
  const firstVisitPage = await launchPage(htmlPath);
  const firstVisitStops = await tabTo(firstVisitPage, '#playBtn');
  await firstVisitPage.close();

  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const returningPage = await launchPage(htmlPath, { initScript });
  t.after(() => returningPage.close());

  assert.equal(await returningPage.evaluate("document.getElementById('picker').hidden"), true, 'a returning learner meets the sheet already shut');
  const returningStops = await tabTo(returningPage, '#playBtn');
  assert.ok(returningStops < firstVisitStops, `returning learner should need fewer Tab stops to reach Start (returning ${returningStops} vs first visit ${firstVisitStops})`);
  assert.match(await returningPage.evaluate("document.getElementById('navInstrument').textContent"), /guitar/i, 'the nav Instrument button still names the saved instrument');
});
