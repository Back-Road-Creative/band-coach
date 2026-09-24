// P2b-2: a Settings destination gathers every housekeeping control a learner
// rarely touches (theme, note naming, backups, reset, update checks, "How
// this works") into one plain screen reached from the nav bar, instead of
// scattering them across the side rail's overflow menu and help disclosure.
// Input setup (the .io row / #setupBtn / #setupSheet) is deliberately left
// on Practice -- see tests/characterization/setup-sheet.test.mjs -- so the
// first-visit journey (choose instrument -> input ready -> first exercise)
// never has to leave Practice.
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
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('boot: Settings is hidden, Practice is current, the rail has no #railMenu or .help, and the moved controls live inside #settingsView', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), true);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page');
  assert.equal(await page.evaluate("document.getElementById('railMenu')"), null, 'no #railMenu anywhere on the page');
  assert.equal(await page.evaluate("document.querySelector('details.help')"), null, 'no details.help anywhere on the page');

  for (const id of ['optTheme', 'resetBtn', 'backupSaveBtn', 'updateCheckBtn', 'helpText']) {
    assert.equal(
      await page.evaluate(`document.getElementById('settingsView').contains(document.getElementById('${id}'))`),
      true,
      `#${id} lives inside #settingsView`,
    );
  }
});

test('clicking Settings shows it and marks it current; clicking Practice goes back', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), true);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current')"), 'page');

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('mainArea').hidden"), false);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')"), 'page');
});

test('clicking Settings while Songs is open closes the songs panel and marks Settings current', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");

  const openPanel = await page.evaluate('window.__coach.panelOpen()');
  assert.ok(openPanel === null || openPanel === undefined, `panelOpen() should be null/undefined, was ${JSON.stringify(openPanel)}`);
  assert.equal(await page.evaluate("document.getElementById('panelHost').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('settingsView').hidden"), false);
  assert.equal(await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').getAttribute('aria-current')"), 'page');
});

test('changing the theme from Settings still applies -- the moved control keeps its handler', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  await page.evaluate("document.getElementById('optTheme').value = 'dark'");
  await page.evaluate("document.getElementById('optTheme').dispatchEvent(new Event('change'))");

  assert.equal(await page.evaluate("document.documentElement.dataset.theme"), 'dark');
});

test('axe-core finds no WCAG 2/2.1 A/AA violations with Settings showing', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(axeSource);
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"settings\"]').click()");
  await page.waitFor("document.getElementById('settingsView').hidden === false");

  const results = await page.evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(WCAG_TAGS)} } })`,
  );
  const lines = results.violations.map((v) => {
    const targets = v.nodes.map((n) => n.target.join(' ')).join(' | ');
    return `  [${v.impact}] ${v.id}: ${v.help}\n    targets: ${targets}`;
  });
  assert.equal(results.violations.length, 0, `Settings showing: ${results.violations.length} axe violation(s)\n${lines.join('\n')}`);
});
