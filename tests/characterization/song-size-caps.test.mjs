// Hardening unit H1, through the real file pickers: a file far too big is
// refused by its size BEFORE a FileReader is ever built (so a phone never
// loads it whole), a crafted tiny MIDI that would build millions of bars is
// refused with a plain reason and nothing is saved, and a backup restore
// reads the file once, not twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const HOSTILE_MIDI = new URL('../fixtures/hostile/huge-ticks.mid', import.meta.url).pathname;
const MB = 1024 * 1024;

// Counts every FileReader the page builds, and every JSON.parse of a backup
// envelope; confirm() says yes so a restore goes all the way through.
const WATCH = `
  window.__readers = 0; window.__backupParses = 0;
  const RealFileReader = window.FileReader;
  window.FileReader = function () { window.__readers++; return new RealFileReader(); };
  window.FileReader.prototype = RealFileReader.prototype;
  const realParse = JSON.parse;
  JSON.parse = function (text, reviver) { if (typeof text === 'string' && text.indexOf('band-coach-progress') !== -1) window.__backupParses++; return realParse.call(this, text, reviver); };
  window.confirm = () => true;
`;

async function openSongs(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('#songsFileInput')");
}
const songsMsg = (page) => page.evaluate("document.querySelector('.panel-songs-msg').textContent");

test('an oversized song file is refused by size, with no FileReader built', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-size-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const big = join(dir, 'huge.mid');
  writeFileSync(big, '');
  truncateSync(big, 40 * MB); // sparse: the picker only needs its size
  const page = await launchPage(HTML_PATH, { initScript: WATCH });
  t.after(() => page.close());
  await openSongs(page);

  await page.setFileInput('#songsFileInput', big);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0");
  const msg = await songsMsg(page);
  assert.match(msg, /40 MB/);
  assert.match(msg, /smaller/i);
  assert.equal(await page.evaluate('window.__readers'), 0, 'no FileReader was constructed for an oversized file');
  assert.deepEqual(page.exceptions, []);
});

test('a crafted 54-byte MIDI that would build millions of bars is refused and nothing is saved', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: WATCH });
  t.after(() => page.close());
  await openSongs(page);
  const rowsBefore = await page.evaluate("document.querySelectorAll('.panel-songs-row button').length");

  await page.setFileInput('#songsFileInput', HOSTILE_MIDI);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0");
  const msg = await songsMsg(page);
  assert.match(msg, /too long/i);
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-msg').dataset.state"), 'no');
  assert.equal(await page.evaluate("document.querySelectorAll('.panel-songs-row button').length"), rowsBefore, 'nothing was added to the library');
  assert.deepEqual(page.exceptions, []);
});

test('an oversized backup is refused by size, with no FileReader built', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-size-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const big = join(dir, 'backup.json');
  writeFileSync(big, '');
  truncateSync(big, 70 * MB);
  const page = await launchPage(HTML_PATH, { initScript: WATCH });
  t.after(() => page.close());

  await page.setFileInput('#backupRestoreInput', big);
  await page.waitFor("document.getElementById('coach').textContent.includes('too large')");
  assert.equal(await page.evaluate('window.__readers'), 0, 'no FileReader was constructed for an oversized backup');
});

test('restoring a backup reads and parses the file once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-size-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'backup.json');
  writeFileSync(file, JSON.stringify({ format: 'band-coach-progress', formatVersion: 2, appVersion: 'x', exportedAt: 'x', db: {}, songs: [] }));
  const page = await launchPage(HTML_PATH, { initScript: WATCH });
  t.after(() => page.close());

  await page.setFileInput('#backupRestoreInput', file);
  await page.waitFor("document.getElementById('coach').textContent === 'Backup restored.'");
  assert.equal(await page.evaluate('window.__backupParses'), 1, 'the backup text was parsed once');
});
