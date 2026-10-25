// An older Guitar Pro file (.gp3, .gp4, .gpx) gets its own message naming
// the formats Band Coach does read, instead of the generic "not supported"
// line. Driven through the real #songsFileInput.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

for (const ext of ['gp4', 'gpx']) {
  test(`a .${ext} file says how to export it, saving nothing`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'band-coach-old-gp-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const filePath = join(dir, 'riff.' + ext);
    writeFileSync(filePath, Buffer.from('FICHIER GUITAR PRO v4.06'));

    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());

    await page.evaluate("window.__coach.setMod('kbd')");
    await page.evaluate("window.__coach.openPanel('songs')");
    await page.waitFor("document.querySelector('.add-song-row')");
    await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
    await page.waitFor("!!document.getElementById('songsFileInput')");
    const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

    await page.setFileInput('#songsFileInput', filePath);
    await page.waitFor("/Guitar Pro/.test(document.querySelector('.panel-songs-msg').textContent)", 10000);

    const said = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
    assert.match(said, /\.gp5/, said);
    assert.match(said, /MusicXML/, said);
    assert.doesNotMatch(said, /not supported yet/, said);
    await page.evaluate("window.__coach.openPanel('songs')");
    assert.equal(await page.evaluate("document.querySelectorAll('.panel-songs-row').length"), rowsBefore, 'nothing was saved');
    assert.deepEqual(page.exceptions, []);
  });
}
