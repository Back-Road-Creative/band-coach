// Teacher challenge lists (plan §11.7 Wave I, unit I6): a teacher-authored
// song list handed over as a plain .json file (plan D6: file exchange only,
// no network/server/account) and, on the export side, a button a teacher
// uses to make one out of their own saved songs. Drives the built page
// through the real file input and a real click, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Note-less parts are still valid songs (src/song/model.js validateSong
// allows an empty notes array) and their lesson plan has zero steps, so
// opening one for practice finishes instantly -- used below to exercise the
// "song passed" path deterministically, without depending on judged timing.
function challengeJson(overrides = {}) {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'Term 1 tunes',
    from: 'Ms Rivera',
    note: 'Play them in order',
    songs: [
      {
        schema: 'song/1', id: 'challenge-song-a', title: 'Challenge Song A', composer: null, licence: null, source: null,
        key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480,
        parts: [{ id: 'melody', name: 'Melody', notes: [] }], chords: []
      },
      {
        schema: 'song/1', id: 'challenge-song-b', title: 'Challenge Song B', composer: null, licence: null, source: null,
        key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480,
        parts: [{ id: 'melody', name: 'Melody', notes: [] }], chords: []
      }
    ],
    ...overrides
  });
}

const FAKE_BLOB_CAPTURE_INIT = `
  window.__exportedBlobs = [];
  const realCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__exportedBlobs.push(blob); return realCreateObjectURL(blob); };
`;

test('a real .json challenge file lands every song in the library and shows the list with progress', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-challenge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'term1.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Term 1 tunes')");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while importing the challenge');

  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent.includes('Challenge Song A'))"
  );

  const challengeTitle = await page.evaluate("document.querySelector('.panel-songs-challenge h3').textContent");
  assert.equal(challengeTitle, 'Term 1 tunes');

  const progressText = await page.evaluate("document.querySelector('.panel-songs-challenge-progress').textContent");
  assert.equal(progressText, '0 of 2 songs passed');

  const songTitles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).map(b => b.textContent)"
  );
  assert.ok(songTitles.some(x => x.includes('Challenge Song A')));
  assert.ok(songTitles.some(x => x.includes('Challenge Song B')));
});

test('a note-less song in a challenge finishes instantly and is marked passed in the challenge list', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-challenge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'term1.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Challenge Song A'))"
  );

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Challenge Song A')).click()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-practice p') && document.querySelector('.panel-songs-practice p').textContent.includes('Nicely done')"
  );

  const progressText = await page.evaluate("document.querySelector('.panel-songs-challenge-progress').textContent");
  assert.equal(progressText, '1 of 2 songs passed');

  const songTitles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).map(b => b.textContent)"
  );
  assert.ok(songTitles.some(x => x.includes('Challenge Song A') && x.includes('passed')));
});

test('exporting builds a downloadable challenge file out of the current library', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-challenge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abcPath = join(dir, 'uploaded-tune.abc');
  writeFileSync(abcPath, 'X:1\nT:Uploaded Tune\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n');

  const page = await launchPage(htmlPath, { initScript: FAKE_BLOB_CAPTURE_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Uploaded Tune')");

  await page.evaluate("document.getElementById('challengeTitleInput').value = 'My export'");
  await page.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Export as a challenge').click()"
  );
  await page.waitFor('window.__exportedBlobs.length > 0');

  const text = await page.evaluate('window.__exportedBlobs[0].text()');
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema, 'challenge/1');
  assert.equal(parsed.title, 'My export');
  assert.ok(parsed.songs.some(s => s.title === 'Uploaded Tune'));

  const exportMsg = await page.evaluate("document.querySelector('.panel-songs-export-msg').textContent");
  assert.match(exportMsg, /Exported/);
});

test('exporting with an empty library says so in plain words, instead of downloading nothing', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_BLOB_CAPTURE_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Export as a challenge').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-export-msg').textContent.length > 0");

  assert.deepEqual(page.exceptions, []);
  assert.equal(await page.evaluate('window.__exportedBlobs.length'), 0);
  const msg = await page.evaluate("document.querySelector('.panel-songs-export-msg').textContent");
  assert.match(msg, /add some songs|first/i);
});

test('an invalid challenge file is reported in plain words, not a crash', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-challenge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const badPath = join(dir, 'bad.json');
  writeFileSync(badPath, '{ "schema": "song/1", "title": "not a challenge" }');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', badPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions on a broken challenge file');
  const msg = await page.evaluate("document.querySelector('.panel-songs-msg').textContent");
  assert.match(msg, /schema|challenge/i);
});
