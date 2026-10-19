// Acceptance: a learner adds a song from a .mid, .musicxml, .mxl or .gp5 file on
// "Add a song", on the release file. The pick is a real file chooser, the clicks
// are real, and nothing reaches through a debug hook (it is stripped from the
// release). For each format: the review names the song, a new row appears in the
// Songs list, opening the row shows the song's practise section, and its
// "Play along" control is enabled -- a song that can be played, not just listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';

const FX = new URL('../fixtures/', import.meta.url).pathname;
const CASES = [
  { format: '.mid', file: FX + 'midi/beat.mid', title: 'untitled' },
  { format: '.musicxml', file: FX + 'musicxml/tutorial-chopin-prelude.musicxml', title: 'tutorial-chopin-prelude' },
  { format: '.mxl', file: FX + 'musicxml/tutorial-chopin-prelude.mxl', title: 'tutorial-chopin-prelude' },
  { format: '.gp5', file: FX + 'gp5/Voices.gp5', title: 'Voices' },
];

const rowTitles = (page) => page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row')).map((li) => li.querySelector('button').textContent.trim())");

for (const c of CASES) {
  test(`T7: a ${c.format} file added on the release file becomes a playable song`, async (t) => {
    await withAcceptancePage(t, {}, async (page) => {
      await page.clickSelector('#mainNav button[data-route="songs"]');
      await page.waitFor("document.querySelector('.add-song-row')");
      const before = await rowTitles(page);
      assert.ok(!before.includes(c.title), `${c.title} is not in the list before the pick`);
      await page.clickSelector('.add-song-row button');
      const added = await chooseFile(page, '#songsFileInput', c.file);
      assert.deepEqual(added.dialogs, [], 'adding a song raises no dialog');
      await page.waitFor("document.querySelector('.panel-learn-result') && document.querySelector('.panel-learn-result').hidden === false");
      assert.equal(await page.evaluate("document.querySelector('.panel-learn-result h4').textContent"), c.title, 'the review names the song');
      await page.waitFor(`Array.from(document.querySelectorAll('.panel-songs-row button')).some((b) => b.textContent.trim() === ${JSON.stringify(c.title)})`);
      const after = await rowTitles(page);
      assert.equal(after.length, before.length + 1, `one new row: ${JSON.stringify(after)}`);
      await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row button')).find((b) => b.textContent.trim() === ${JSON.stringify(c.title)}).click()`);
      await page.waitFor("document.querySelector('.panel-songs-action-playalong')");
      assert.equal(await page.evaluate("document.querySelector('.panel-songs-action-playalong').disabled"), false, 'Play along is enabled');
      assert.equal(await page.evaluate("document.querySelector('.panel-songs-practice') && document.querySelector('.panel-songs-practice').textContent.includes('no notes to practise')"), false, 'the song has notes to practise');
    });
  });
}
