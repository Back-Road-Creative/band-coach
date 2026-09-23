// Wave J2: DB.prefs.noteNaming is { system, accidentals }, whitelisted the
// same way DB.prefs.theme is (J1) -- an unknown or missing saved value
// sanitises to the default { letters, mixed } rather than throwing or
// leaving the two selects stuck on something they can't render. Drives the
// real sanitizeDB() through localStorage + reload, same pattern as
// tests/unit/theme-pref-sanitize.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('no saved prefs at all sanitises noteNaming to letters/mixed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const nn = await page.evaluate('window.__coach.db().prefs.noteNaming');
  assert.deepEqual(nn, { system: 'letters', accidentals: 'mixed' });
});

test('an unrecognised saved noteNaming value sanitises to the default', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const garbage = JSON.stringify({ v: 1, mods: {}, sessions: [], prefs: { noteNaming: { system: 'klingon', accidentals: 'up' } } });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(garbage)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const nn = await page.evaluate('window.__coach.db().prefs.noteNaming');
  assert.deepEqual(nn, { system: 'letters', accidentals: 'mixed' });
});

test('a valid saved noteNaming value survives sanitising', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const good = JSON.stringify({ v: 1, mods: {}, sessions: [], prefs: { noteNaming: { system: 'german', accidentals: 'flats' } } });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(good)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const nn = await page.evaluate('window.__coach.db().prefs.noteNaming');
  assert.deepEqual(nn, { system: 'german', accidentals: 'flats' });
});
