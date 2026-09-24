// P3-10: "Edit notes" opens any song -- a starter tune included -- keeps
// unsaved changes across a panel switch, and saves honestly (a plain "Not
// saved yet"/"Saved" line, Practise this/Back to songs only once something
// is actually saved, and the song's own Draft/Checked status in Songs).
// Drives the built page through real clicks, same pattern as
// tests/characterization/songs-song-actions.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function openHotCrossBuns(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
}

async function clickEditNotes(page) {
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Edit notes').click()"
  );
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
}

// A Q: tempo field is included so this imports with no warnings -- straight
// to Checked, same reasoning as tests/characterization/songs-add-a-song.
// test.mjs's own ABC constant.
const ABC = 'X:1\nT:Edit Notes Test\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';

async function openAddSongSection(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()"
  );
}

test('Edit notes on a starter song saves a copy of your own', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickEditNotes(page);
  await page.waitFor("document.getElementById('editorTitle').value === 'My copy of Hot Cross Buns'");

  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'My copy of Hot Cross Buns')"
  );

  const starterStillThere = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Hot Cross Buns')"
  );
  assert.equal(starterStillThere, true, 'the starter row is unchanged');
});

test('unsaved edits survive opening Settings and coming back', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickEditNotes(page);
  await page.waitFor("document.getElementById('editorTitle').value === 'My copy of Hot Cross Buns'");

  await page.evaluate(`(function(){
    var el = document.getElementById('editorTitle');
    el.value = 'My Edited Copy';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await page.evaluate("document.querySelector('button[data-route=\"settings\"]').click()");
  await page.waitFor("document.getElementById('settingsView').hidden === false");

  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("document.getElementById('editorTitle').value === 'My Edited Copy'");

  assert.equal(await page.evaluate("document.querySelector('.editor-saved-status').textContent"), 'Not saved yet');
});

test('saving a draft with no checks left marks it Checked', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-edit-notes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'tune.abc');
  writeFileSync(abcPath, ABC, 'utf8');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openAddSongSection(page);
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Edit Notes Test')"
  );

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Edit Notes Test').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
  await clickEditNotes(page);
  await page.waitFor("document.getElementById('editorTitle').value === 'Edit Notes Test'");

  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(
    "(() => { var b = Array.from(document.querySelectorAll('.panel-songs-row button')).find(x => x.textContent === 'Edit Notes Test'); return !!(b && b.parentElement.querySelector('.panel-songs-status')); })()"
  );
  // statusLabel() (src/ui/songs/song-status.js) always appends "Original
  // recording not kept" when the ledger entry says so -- a notation import
  // never had audio to keep in the first place, so that honest caveat rides
  // along even once the song reads Checked; only the leading word matters
  // here.
  const statusText = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Edit Notes Test').parentElement.querySelector('.panel-songs-status').textContent"
  );
  assert.equal(statusText.split(' — ')[0], 'Checked');
});

test('Back to songs returns to the list', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickEditNotes(page);
  await page.waitFor("document.getElementById('editorTitle').value === 'My copy of Hot Cross Buns'");

  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");

  await page.evaluate("document.getElementById('editorBackToSongsBtn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
});
