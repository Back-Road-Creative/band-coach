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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const axeSource = readFileSync(
  fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url)),
  'utf8',
);

// Same four tag families as tests/characterization/a11y-axe.test.mjs -- the
// WCAG 2/2.1 A/AA bar, not the noisier AAA rules.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function formatViolations(label, violations) {
  const lines = violations.map((v) => {
    const targets = v.nodes.map((n) => n.target.join(' ')).join(' | ');
    return `  [${v.impact}] ${v.id}: ${v.help}\n    targets: ${targets}`;
  });
  return `${label}: ${violations.length} axe violation(s)\n${lines.join('\n')}`;
}

async function scan(page, label) {
  const results = await page.evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(WCAG_TAGS)} } })`,
  );
  assert.equal(results.violations.length, 0, formatViolations(label, results.violations));
}

// Presses real Tab keys, one at a time, until `selector` holds focus, then
// returns how many it took. This walks the browser's OWN tab order rather
// than predicting it from a DOM query: a closed <details> (this app's
// #panelPickerDisclosure) renders its non-<summary> content with
// `content-visibility: hidden`, which still reports a real
// getBoundingClientRect()/offsetParent for that content (measured directly
// against this build) even though nothing paints and Chrome's real Tab
// order skips straight over it -- so any static "is it focusable" query is
// exactly the kind of guess this suite exists to replace with what the
// browser actually does. `maxPresses` is a runaway guard, not a budget:
// this suite does not assert a specific number of presses except where the
// acceptance itself calls for a *comparison* (see the second test below).
async function tabTo(page, selector, maxPresses = 60) {
  for (let i = 1; i <= maxPresses; i++) {
    await page.press('Tab');
    const ok = await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
    if (ok) return i;
  }
  const got = await page.evaluate('document.activeElement.outerHTML || document.activeElement.tagName');
  throw new Error(`tabTo: ${selector} not reached within ${maxPresses} Tab presses (last landed on ${got})`);
}

// Plain-object copy of getBoundingClientRect() -- DOMRect's own properties
// are prototype getters, so returnByValue's JSON serialisation over CDP
// would otherwise hand back `{}`.
async function rectOf(page, selector) {
  return page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  })()`);
}

function assertInFirstScreen(rect, height, label) {
  assert.ok(rect.top >= 0, `${label}: top ${rect.top} is above the viewport`);
  assert.ok(rect.bottom <= height, `${label}: bottom ${rect.bottom} falls below the ${height}px first screen`);
}

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
