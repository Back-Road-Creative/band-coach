// New behaviour (plan 7.7): behaviour a11y tests pin specific interactions
// (focus trapping, reduced motion, wake-lock messaging) but nothing had ever
// run a real WCAG scanner over the built app. This runs axe-core
// (node_modules/axe-core, an exact-pinned devDependency -- see package.json)
// over the built, self-contained dist/band-coach.html in its main states, so
// a violation anywhere on the page fails the suite instead of only the
// handful of things a hand-written characterization test happens to check.
//
// axe-core ships as one plain <script> file (axe.min.js) with no module
// exports, so it is injected the same way the app itself runs: as source
// text evaluated in the already-loaded file:// page (nothing is fetched over
// the network -- see tests/helpers/browser.mjs's own file:// requirement).
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

// The four WCAG tag families axe-core ships rules for at level A/AA -- the
// bar a public, general-audience app should clear. Level AAA rules are
// aspirational and noisy (many are genuinely optional even for accessible
// sites), so they are deliberately left out rather than scanned and ignored.
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

test('axe-core finds no WCAG 2/2.1 A/AA violations across the app\'s main states', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // axe defines window.axe as a side effect of running; nothing to await --
  // it is a plain synchronous IIFE bundle, same as the app's own inlined
  // script.
  await page.evaluate(axeSource);

  await t.test('first load', async () => {
    await scan(page, 'first load');
  });

  await t.test('instrument selected and a lesson started', async () => {
    await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    await scan(page, 'instrument selected + lesson started');
    // Back to idle before the panel states below so the lesson's own
    // transient UI (break card, feedback) can't bleed into them.
    await page.evaluate("document.getElementById('endBtn').click()");
  });

  // Each side panel: real entry points only, per its actual P2b-3 home --
  // History from the nav bar, Songs from the nav bar, and the instrument
  // sheet's Tools group for the two feature panels that live there
  // (buildPanelToolButton() in src/app.js, one real
  // addEventListener('click', ...) per button, not a debug-hook call).
  for (const panelId of ['history', 'songs']) {
    await t.test(`${panelId} panel open`, async () => {
      const route = panelId === 'history' ? 'progress' : panelId;
      await page.evaluate(`document.querySelector('#mainNav button[data-route="${route}"]').click()`);
      await page.waitFor(`window.__coach.panelOpen() === ${JSON.stringify(panelId)}`);
      await scan(page, `${panelId} panel open`);
    });
  }

  for (const panelId of ['fingerings', 'theory']) {
    await t.test(`${panelId} panel open`, async () => {
      await page.evaluate("document.getElementById('navInstrument').click()");
      await page.waitFor("document.getElementById('picker').hidden === false");
      await page.evaluate(
        `document.querySelector('#picker .picker-tools button[data-panel="${panelId}"]').click()`,
      );
      await page.waitFor(`window.__coach.panelOpen() === ${JSON.stringify(panelId)}`);
      await scan(page, `${panelId} panel open`);
    });
  }

  // "Set up input" is Band Coach's settings surface (mic/MIDI device,
  // calibration) -- there is no separate settings panel module, this sheet
  // is it (src/index.html's #setupSheet, toggled by src/app.js's real
  // #setupBtn click listener).
  await t.test('settings (set up input) sheet open', async () => {
    await page.evaluate("document.getElementById('setupBtn').click()");
    await page.waitFor("document.getElementById('setupSheet').hidden === false");
    await scan(page, 'settings sheet open');
  });
});
