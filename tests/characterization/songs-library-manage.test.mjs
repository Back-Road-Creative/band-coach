// A learner can remove a song they saved (two taps, never one), and a file
// that gave no notes is refused instead of saved as a junk song. Drives the
// built page through real clicks and a real file pick, same pattern as
// tests/characterization/songs-edit-notes.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const ABC = 'X:1\nT:Remove Me\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';

async function openAdd(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()"
  );
}
const rowTitles = "Array.from(document.querySelectorAll('.panel-songs-row > button:first-child')).map(b => b.textContent)";

test('a saved song can be removed, after a second tap; Keep leaves it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-manage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'remove-me.abc');
  writeFileSync(abcPath, ABC);
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await openAdd(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor(`${rowTitles}.includes('Remove Me')`, 20000);
  // A notation import never had a recording: no "recording not kept" caveat.
  const status = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row')).find(r => r.textContent.indexOf('Remove Me') === 0).querySelector('.panel-songs-status').textContent"
  );
  assert.equal(status, 'Checked');
  // Starter tunes are built in: no remove control on them.
  assert.equal(await page.evaluate("document.querySelectorAll('.panel-songs-row').length - document.querySelectorAll('.panel-songs-remove').length > 0"), true);
  assert.equal(await page.evaluate("document.querySelectorAll('.panel-songs-remove').length"), 1);

  const click = (sel) => page.evaluate(`document.querySelector('${sel}').click()`);
  await click('.panel-songs-remove');
  await page.waitFor("!!document.querySelector('.panel-songs-remove-yes')");
  await click('.panel-songs-remove-keep');
  await page.waitFor("!!document.querySelector('.panel-songs-remove') && !document.querySelector('.panel-songs-remove-yes')");
  assert.equal(await page.evaluate(`${rowTitles}.includes('Remove Me')`), true);

  await click('.panel-songs-remove');
  await page.waitFor("!!document.querySelector('.panel-songs-remove-yes')");
  await click('.panel-songs-remove-yes');
  await page.waitFor(`!${rowTitles}.includes('Remove Me')`);
  // Gone for good: still gone after a reload.
  await page.reload();
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  assert.equal(await page.evaluate(`${rowTitles}.includes('Remove Me')`), false);
});

test('an empty or note-less .abc file is refused, not saved', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const emptyPath = join(dir, 'empty.abc');
  writeFileSync(emptyPath, '');
  const headerPath = join(dir, 'header-only.abc');
  writeFileSync(headerPath, 'X:1\nT:Header Only\nM:4/4\nK:C\n');
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await openAdd(page);
  const before = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  for (const p of [emptyPath, headerPath]) {
    await page.setFileInput('#songsFileInput', p);
    await page.waitFor("/no notes/i.test(document.querySelector('.panel-songs-msg').textContent)", 20000);
    await page.evaluate("document.querySelector('.panel-songs-msg').textContent = ''");
  }
  assert.equal(await page.evaluate("document.querySelectorAll('.panel-songs-row').length"), before);
});
