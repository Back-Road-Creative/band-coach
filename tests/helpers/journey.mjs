// Shared helpers for the "journey" characterization tests -- axe-core scans
// and real-keyboard navigation over a launchPage() session. Moved out of
// journey-first-visit.test.mjs so journey-practice-progress, journey-songs
// and journey-keyboard-nav can reuse the exact same axe tags, violation
// formatting and Tab/rect helpers rather than each growing their own copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const axeSource = readFileSync(
  fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url)),
  'utf8',
);

// Same four tag families as tests/characterization/a11y-axe.test.mjs -- the
// WCAG 2/2.1 A/AA bar, not the noisier AAA rules.
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export function formatViolations(label, violations) {
  const lines = violations.map((v) => {
    const targets = v.nodes.map((n) => n.target.join(' ')).join(' | ');
    return `  [${v.impact}] ${v.id}: ${v.help}\n    targets: ${targets}`;
  });
  return `${label}: ${violations.length} axe violation(s)\n${lines.join('\n')}`;
}

export async function scan(page, label) {
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
export async function tabTo(page, selector, maxPresses = 60) {
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
export async function rectOf(page, selector) {
  return page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
  })()`);
}

export function assertInFirstScreen(rect, height, label) {
  assert.ok(rect.top >= 0, `${label}: top ${rect.top} is above the viewport`);
  assert.ok(rect.bottom <= height, `${label}: bottom ${rect.bottom} falls below the ${height}px first screen`);
}
