// F17: the Songs list shows the starters that fit the chosen instrument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const rowTitles = (page) => page.evaluate("Array.from(document.querySelectorAll('.panel-songs-list .panel-songs-row > button')).map(b => b.textContent)");

async function showSongs(page, mod) {
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-list .panel-songs-row button').length > 0");
}

test('the Songs list differs between the keyboard and the tin whistle', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await showSongs(page, 'kbd');
  const keys = await rowTitles(page);
  await showSongs(page, 'tin-whistle');
  const whistle = await rowTitles(page);
  assert.notDeepEqual(keys, whistle);
  assert.ok(keys.includes('Hot Cross Buns'));
  assert.deepEqual(page.exceptions, []);
});

test('switching to the B-flat trumpet shows the B-flat versions, and marks what will not fit', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await showSongs(page, 'kbd');
  assert.ok(!(await rowTitles(page)).some((x) => x.includes('(in B♭)')));
  await showSongs(page, 'trumpet-bb');
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row > button')).some(b => b.textContent.includes('(in B♭)'))");
  assert.ok((await rowTitles(page)).includes('Hot Cross Buns (in B♭)'));
  assert.ok(await page.evaluate("document.querySelectorAll('.panel-songs-notall').length > 0"), 'a not-all-notes label shows');
  assert.deepEqual(page.exceptions, []);
});
