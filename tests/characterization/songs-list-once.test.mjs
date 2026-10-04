// A saved song is listed once in the Songs library. Opening the panel fresh
// mounts it and shows it back to back; both used to rebuild the list before
// the library's (async) IndexedDB read finished, so each saved song was
// appended twice (src/ui/songs.js refreshList). Real file input, real IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const ABC = 'X:1\nT:Listed Once Tune\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';
const COUNT = "Array.from(document.querySelectorAll('li.panel-songs-row button')).filter(b => b.textContent === 'Listed Once Tune').length";

test('a saved song is listed once each time Songs opens, including after a reload', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-list-once-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-learn-practise-btn')).find(b => b.textContent === 'Practise this').click()",
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h3')");

  await page.reload();
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(COUNT + ' > 0');
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await page.evaluate(COUNT), 1, 'listed once after a reload');

  await page.evaluate("window.__coach.openPanel('songs')");
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await page.evaluate(COUNT), 1, 'still once when Songs is shown again');
  assert.deepEqual(page.exceptions, []);
});
