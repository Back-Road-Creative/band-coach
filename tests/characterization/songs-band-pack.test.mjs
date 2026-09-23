// Band packs (Wave I, src/song/band-pack.js): a whole band's set list, plus
// optionally who plays which part of each song, handed around as ONE
// .bandpack zip file -- same file-exchange pattern as the teacher challenge
// lists in tests/characterization/songs-challenge.test.mjs, no network/
// server/account (plan D6). Drives the built page through the real file
// input and a real click, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { writeBandPack, readBandPack } from '../../src/song/band-pack.js';

const htmlPath = HTML_PATH;

// Same note-less-song trick as songs-challenge.test.mjs: an empty notes
// array is still a valid song (src/song/model.js validateSong), so this test
// only needs the pack itself to be real, not a playable tune.
function song(id, title, parts) {
  return {
    schema: 'song/1', id, title, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480,
    parts, chords: [],
  };
}

function buildPack() {
  const songA = song('band-pack-song-a', 'Pack Song A', [{ id: 'melody', name: 'Melody', notes: [] }]);
  const songB = song('band-pack-song-b', 'Pack Song B', [
    { id: 'melody', name: 'Melody', notes: [] },
    { id: 'bass', name: 'Bass', notes: [] },
  ]);
  return writeBandPack({
    name: 'Our Set',
    songs: [songA, songB],
    parts: [null, { Alex: 0, Sam: 1 }],
  });
}

const FAKE_BLOB_CAPTURE_INIT = `
  window.__exportedBlobs = [];
  const realCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__exportedBlobs.push(blob); return realCreateObjectURL(blob); };
`;

test('a real .bandpack file lands every song in the library and shows any part assignments read-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-bandpack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packPath = join(dir, 'ourset.bandpack');
  writeFileSync(packPath, buildPack());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  await page.setFileInput('#songsFileInput', packPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Our Set')");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while importing the band pack');

  const msg = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(msg, /Added 2 songs from band pack "Our Set"/);

  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent.includes('Pack Song A'))"
  );
  const titles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)"
  );
  assert.ok(titles.includes('Pack Song A'), 'song with no part assignment still lands in the library: ' + titles.join(', '));
  assert.ok(titles.includes('Pack Song B'), 'song with a part assignment lands in the library: ' + titles.join(', '));

  // Only the song carrying an assignment gets a read-only line; the one with
  // no assignment (Pack Song A) is not mentioned.
  const assignmentText = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-band-pack-parts')).map(el => el.textContent).join('\\n')"
  );
  assert.match(assignmentText, /Pack Song B:.*Alex plays Melody/);
  assert.match(assignmentText, /Pack Song B:.*Sam plays Bass/);
  assert.doesNotMatch(assignmentText, /Pack Song A/);
});

test('an invalid band pack file is reported in plain words, not a crash', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-bandpack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'bad.bandpack');
  writeFileSync(badPath, 'not a zip at all');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', badPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions on a broken band pack file');
  const msg = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(msg, /band pack|zip/i);
});

test('"Share with your band" downloads a .bandpack file that readBandPack accepts, built from the current library', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-bandpack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'uploaded-tune.abc');
  writeFileSync(abcPath, 'X:1\nT:Uploaded Tune\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n');

  const page = await launchPage(htmlPath, { initScript: FAKE_BLOB_CAPTURE_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Uploaded Tune')");
  // The message lands before refreshList() re-reads the library and enables
  // Share (src/ui/songs.js refreshList); clicking a disabled button does nothing.
  await page.waitFor(
    "Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Share with your band' && !b.disabled)"
  );

  await page.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Share with your band').click()"
  );
  await page.waitFor('window.__exportedBlobs.length > 0');

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
  assert.ok(pack.songs.some((s) => s.title === 'Uploaded Tune'), 'the exported pack contains the library song');
});

test('"Share with your band" is disabled with an empty library, matching the challenge export', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_BLOB_CAPTURE_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  const disabled = await page.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Share with your band').disabled"
  );
  assert.equal(disabled, true, 'the share button is disabled until the library has a song');
});
