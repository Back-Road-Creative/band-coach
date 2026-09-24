import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('a backup can be exported and restored into a fresh profile', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor(`window.__coach.db().mods.kbd.item['n' + ${midi}]`, 3000);

  const before = await page.evaluate(`window.__coach.db().mods.kbd.item['n' + ${midi}].m`);
  // exportProgress() is now async (it reads the song library too), so the
  // expression itself must be a promise for evaluate()'s awaitPromise to wait
  // on it -- JSON.stringify(exportProgress()) would stringify the Promise
  // object itself, not its resolved value.
  const backupText = await page.evaluate('(async () => JSON.stringify(await window.__coach.exportProgress()))()');

  const fresh = await launchPage(htmlPath);
  t.after(() => fresh.close());
  await fresh.evaluate("localStorage.clear()");
  await fresh.reload();
  await fresh.waitFor('typeof window.__coach !== "undefined"', 8000);

  const importResult = await fresh.evaluate(
    `window.__coach.importProgress(${JSON.stringify(backupText)})`
  );
  assert.equal(importResult.ok, true, 'import reports success on a real backup');

  const after = await fresh.evaluate(`window.__coach.db().mods.kbd.item['n' + ${midi}].m`);
  assert.equal(after, before, 'the answered item\'s mastery survived the round trip');
});

test('importing garbage leaves existing progress untouched and reports an error', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor(`window.__coach.db().mods.kbd.item['n' + ${midi}]`, 3000);

  const before = await page.evaluate('JSON.stringify(window.__coach.db())');

  const result = await page.evaluate("window.__coach.importProgress('not json at all {{{')");
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length, 'a plain-English error message is returned');

  const after = await page.evaluate('JSON.stringify(window.__coach.db())');
  assert.equal(after, before, 'a rejected import never mutates the existing db');
});
