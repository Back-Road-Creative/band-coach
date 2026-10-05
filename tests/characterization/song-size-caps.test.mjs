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

// A song saved BEFORE the ceiling existed can still be in the library: opening it must say so, not leave a blank lesson.
test('opening a saved song that is too long to open says why and leaves the screen usable', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const song = { schema: 'song/1', id: 'legacy', title: 'Legacy Huge', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480, parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 5368709100, midi: 62 }] }], chords: [] };
  await page.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('bandcoach-songs', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv');
    st.put(${JSON.stringify(song)}, 'song:legacy'); st.put({ id: 'legacy', title: 'Legacy Huge', addedAt: 1, durationTicks: 5368709580, durationSeconds: 1 }, 'meta:legacy');
    await new Promise((res) => { tx.oncomplete = res; }); db.close();
  })()`);
  await openSongs(page);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Legacy Huge')");

  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Legacy Huge').click()");
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0", 5000).catch(() => {}); // a silent failure must show up as the assertions below, not as a timeout
  const msg = await songsMsg(page);
  assert.match(msg, /too long/i);
  assert.match(msg, /remove/i, 'the learner is told what to do about it');
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-msg').dataset.state"), 'no');
  assert.match(await page.evaluate("document.getElementById('panelSay').textContent"), /too long/i, 'it is said where the learner is looking');
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-practice').hidden"), true, 'no blank lesson is left on screen');
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-library').open"), true, 'the song list stays open so the song can be removed');
  assert.equal(await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Remove')"), true);
  assert.deepEqual(page.exceptions, []);
});

// The other ways into a lesson reach startPractice() without openSong(): Carry on (a multi-part song), and a requestOpenSong() hand-off.
const LEGACY_2PART = { schema: 'song/1', id: 'legacy', title: 'Legacy Huge', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
  parts: [{ id: 'p', name: 'P', notes: [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 5368709100, midi: 62 }] }, { id: 'q', name: 'Q', notes: [{ start: 0, dur: 480, midi: 48 }] }], chords: [] };
async function seedLegacy(page) {
  await page.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('bandcoach-songs', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv');
    st.put(${JSON.stringify(LEGACY_2PART)}, 'song:legacy'); st.put({ id: 'legacy', title: 'Legacy Huge', addedAt: 1, durationTicks: 5368709580, durationSeconds: 1 }, 'meta:legacy');
    await new Promise((res) => { tx.oncomplete = res; }); db.close();
  })()`);
}
async function assertRefusedCleanly(page) {
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.length > 0", 5000).catch(() => {}); // a silent failure must show up as the assertions below, not as a timeout
  assert.match(await songsMsg(page), /too long/i);
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-msg').dataset.state"), 'no');
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-practice').hidden"), true, 'no blank lesson is left on screen');
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-library').open"), true, 'the song list is open so the song can be removed');
  await new Promise((r) => setTimeout(r, 300)); // an uncaught error from the lesson builder lands a moment later
  assert.deepEqual(page.exceptions, []);
}

test('Carry on for a multi-part saved song that is too long says why, with no uncaught error', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seedLegacy(page);
  await page.evaluate(`(() => { const db = window.__coach.db(); db.panels = db.panels || {}; db.panels.songs = { lessons: [{ key: { songId: 'legacy', rev: 'x', partId: 'p', arrangement: 'x', setup: 'kbd', tempo: 1, assist: 'none' }, stepIndex: 1, tail: [], level: 1 }] }; })()`);
  await openSongs(page);
  await page.waitFor("document.querySelector('.panel-songs-carry-on') && !document.querySelector('.panel-songs-carry-on').hidden", 10000);
  await page.evaluate("document.querySelector('.panel-songs-carry-on').click()");
  await assertRefusedCleanly(page);
});

test('a hand-off (requestOpenSong) naming a saved song that is too long says why, with no uncaught error', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seedLegacy(page);
  await page.evaluate(`(() => { const db = window.__coach.db(); db.panels = db.panels || {}; db.panels['songs-open-request'] = { songId: 'legacy', partId: 'p', instrumentId: null, returnTo: null, mode: null }; })()`);
  await openSongs(page);
  await assertRefusedCleanly(page);
});

test('clicking a multi-part saved song that is too long says why and leaves the library open', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seedLegacy(page);
  await openSongs(page);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Legacy Huge')");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Legacy Huge').click()");
  await assertRefusedCleanly(page);
});
