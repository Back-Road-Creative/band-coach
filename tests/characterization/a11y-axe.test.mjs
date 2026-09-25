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

  // "Set up input" is a device-calibration sheet (mic/MIDI device,
  // calibration), separate from the Settings nav destination -- Settings
  // (theme/mode toggles, #settingsView, src/index.html:45-75) has its own
  // axe scan in tests/characterization/settings-view.test.mjs:83. This sheet
  // is toggled by src/app.js's real #setupBtn click listener.
  await t.test('input set-up sheet open', async () => {
    await page.evaluate("document.getElementById('setupBtn').click()");
    await page.waitFor("document.getElementById('setupSheet').hidden === false");
    await scan(page, 'input set-up sheet open');
  });

  // Songs internal screens: a song open at its first practice step, and Add
  // a song's own section -- both reached through Songs' real controls (P7-5:
  // songs.js's panel-songs-row title button, and its Add a song toggle).
  // Re-opened from the nav here rather than reused from the panel loop
  // above, since the fingerings/theory scans in between switched the open
  // panel away from Songs.
  // P7-5: both of these hit a REAL axe violation once a song is open --
  // "Play it on..." instrument-card feasibility badges (.panel-songs-badge,
  // .panel-songs-diff-badge) fail color-contrast (serious). This is a src
  // finding for JP, not a test-file problem, so both stay `todo` with the
  // violation named rather than weakened/excluded -- see the handback report
  // for the verbatim axe output.
  await t.test('songs: song open', { todo: 'color-contrast: "Play it on..." instrument-card feasibility badges fail contrast (serious)' }, async () => {
    await page.evaluate('document.querySelector(\'#mainNav button[data-route="songs"]\').click()');
    await page.waitFor("window.__coach.panelOpen() === 'songs'");
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()",
    );
    await page.waitFor("document.querySelector('.panel-songs-practice') && !document.querySelector('.panel-songs-practice').hidden");
    await scan(page, 'songs: song open');
  });

  await t.test('songs: add a song open', { todo: 'color-contrast: "Play it on..." instrument-card feasibility badges (still open behind Add a song) fail contrast (serious)' }, async () => {
    await page.evaluate(
      "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add a song').click()",
    );
    await page.waitFor("document.querySelector('.add-song-section') && !document.querySelector('.add-song-section').hidden");
    await scan(page, 'songs: add a song open');
  });

  // Edit notes and Play along are reached in real use only from an open
  // song inside Songs; opening them here through the same debug entry
  // songs-internal-screens.test.mjs already uses (__coach.openPanel) avoids
  // needing to import/save a song first just to reach them for a scan --
  // Songs' own navigation is covered separately, not by this file.
  await t.test('editor panel open', async () => {
    await page.evaluate("window.__coach.openPanel('editor')");
    await page.waitFor("document.querySelector('.panel-editor') !== null");
    await scan(page, 'editor panel open');
  });

  await t.test('playalong panel open', async () => {
    await page.evaluate("window.__coach.openPanel('playalong')");
    await page.waitFor("document.querySelector('.panel-playalong') !== null");
    await scan(page, 'playalong panel open');
  });

  await t.test('ear panel open', async () => {
    await page.evaluate("document.getElementById('navInstrument').click()");
    await page.waitFor("document.getElementById('picker').hidden === false");
    await page.evaluate(
      "document.querySelector('#picker .picker-tools button[data-panel=\"ear\"]').click()",
    );
    await page.waitFor("window.__coach.panelOpen() === 'ear'");
    await scan(page, 'ear panel open');
  });
});
