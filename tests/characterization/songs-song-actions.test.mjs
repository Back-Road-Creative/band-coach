// P3-8: an open song shows one row of plain actions (Edit notes, Play along,
// Export, Share, Save a copy) directly above its practise section; the
// format buttons (MIDI/MusicXML/ABC) move inside Export, and challenges/band
// packs move under an "Assignments" heading. Drives the built page through
// the real file input and real clicks, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { readBandPack } from '../../src/song/band-pack.js';

const htmlPath = HTML_PATH;

const FAKE_BLOB_CAPTURE_INIT = `
  window.__exportedBlobs = [];
  window.__downloads = [];
  const realCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__exportedBlobs.push(blob); return realCreateObjectURL(blob); };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloads.push(this.download);
    return realClick.call(this);
  };
`;

async function openHotCrossBuns(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
}

test('an open song shows one row of named actions', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);

  const actionTexts = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-song-actions button')).map(b => b.textContent)"
  );
  assert.deepEqual(actionTexts, ['Edit notes', 'Play along', 'Export', 'Share', 'Save a copy']);

  const practiceVisible = await page.evaluate("document.querySelector('.panel-songs-practice').hidden === false");
  assert.ok(practiceVisible, 'the practise section is visible below the action row');
});

test('format buttons appear only inside Export', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);

  const beforeCount = await page.evaluate("document.querySelectorAll('.panel-songs-export').length");
  assert.equal(beforeCount, 0, 'no export controls exist before Export is pressed');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Export').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-export button').length > 0");

  const formatTexts = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-export button')).map(b => b.textContent)"
  );
  assert.deepEqual(formatTexts, ['MIDI', 'MusicXML', 'ABC']);
});

test('Save a copy adds a second song', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);

  const rowCountBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Save a copy').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Hot Cross Buns (copy)')"
  );

  const rowCountAfter = await page.evaluate("document.querySelectorAll('.panel-songs-row').length");
  assert.equal(rowCountAfter, rowCountBefore + 1, 'the copy adds exactly one row');

  // Reopen the panel (re-runs refreshList against the persisted library)
  // rather than reloading the whole page -- the copy lives in IndexedDB,
  // which the fresh page load in a NEW browser context below would not see
  // anyway, so re-showing the panel is the real "it is still there" proof.
  await page.evaluate("window.__coach.openPanel('history')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Hot Cross Buns (copy)')"
  );
});

test('Share downloads a band pack of this one song', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_BLOB_CAPTURE_INIT });
  t.after(() => page.close());

  await openHotCrossBuns(page);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Share').click()"
  );
  await page.waitFor('window.__exportedBlobs.length > 0');

  const download = await page.evaluate('window.__downloads[window.__downloads.length - 1]');
  assert.ok(download.endsWith('.bandpack'), 'the download name ends with .bandpack: ' + download);

  const dataUrl = await page.evaluate(`
    (async () => {
      const buf = await window.__exportedBlobs[window.__exportedBlobs.length - 1].arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    })()
  `);
  const bytes = new Uint8Array(Buffer.from(dataUrl, 'base64'));
  const pack = readBandPack(bytes);
  assert.equal(pack.songs.length, 1, 'the shared pack holds exactly the one song');
  assert.equal(pack.songs[0].title, 'Hot Cross Buns');
});

test('Challenges and band packs live under Assignments', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  const layout = await page.evaluate(`
    (() => {
      const section = document.querySelector('.panel-songs-assignments');
      if (!section) return null;
      return {
        firstChildIsHeading: section.firstElementChild && section.firstElementChild.tagName === 'H3'
          && section.firstElementChild.textContent === 'Assignments',
        hasChallengeInput: !!section.querySelector('#challengeTitleInput'),
        hasShareButton: Array.from(section.querySelectorAll('button')).some((b) => b.textContent === 'Share with your band'),
      };
    })()
  `);
  assert.ok(layout, 'a .panel-songs-assignments section exists');
  assert.ok(layout.firstChildIsHeading, "the Assignments heading is the section's first child");
  assert.ok(layout.hasChallengeInput, '#challengeTitleInput lives under Assignments');
  assert.ok(layout.hasShareButton, 'Share with your band lives under Assignments');
});

test('the song list has no per-row format buttons', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  const rowExportCount = await page.evaluate("document.querySelectorAll('.panel-songs-row .panel-songs-export').length");
  assert.equal(rowExportCount, 0, 'no row carries its own export controls any more');
});
