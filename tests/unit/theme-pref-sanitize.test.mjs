// Unit J1: DB.prefs.theme is 'system' | 'light' | 'dark'. A missing or
// unknown saved value must sanitise to 'system' rather than throw or leave
// the toggle stuck on a value it can't render. Drives the real sanitizeDB()
// through localStorage + reload exactly like the existing "garbage preloaded"
// case in tests/characterization/persistence.test.mjs, rather than
// re-implementing the rule here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('no saved prefs at all sanitises theme to system', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const theme = await page.evaluate('window.__coach.db().prefs.theme');
  assert.equal(theme, 'system');
});

test('an unrecognised saved theme value sanitises to system', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const garbage = JSON.stringify({ v: 1, mods: {}, sessions: [], prefs: { theme: 'purple' } });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(garbage)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const theme = await page.evaluate('window.__coach.db().prefs.theme');
  assert.equal(theme, 'system');
});

test('a valid saved theme value survives sanitising', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const good = JSON.stringify({ v: 1, mods: {}, sessions: [], prefs: { theme: 'dark' } });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(good)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const theme = await page.evaluate('window.__coach.db().prefs.theme');
  assert.equal(theme, 'dark');
});
