// A saved copy of a starter tune is its own song. Edit notes on "Hot Cross Buns"
// opens "My copy of Hot Cross Buns"; Save to my songs / Save a copy store it. The
// copy used to be stored under the starter's own id, so every lookup that checks
// the shipped starters first (the editor's "Practise this", Carry on) found the
// starter and opened that, not the copy the learner had just made. A starter's id
// is now reserved (src/song/library.js), so the copy has its own id and those
// lookups open it. Every step is a real click on the dev build; window.__coach is
// used for setup (the instrument) only. The waits are neutral (a lesson heading
// that is a new element, a row that exists), so a regression is an assertion on
// what the learner sees, not a timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterSongs } from '../../src/song/starter/index.js';

const htmlPath = HTML_PATH;
const TITLE = 'Hot Cross Buns';
const COPY_TITLE = 'My copy of Hot Cross Buns';

const lessonState = (page) => page.evaluate(`(() => {
  const s = document.querySelector('.panel-songs-practice');
  const h4 = s && s.querySelector('h4');
  return { hidden: s.hidden, display: getComputedStyle(s).display, offsetParent: s.offsetParent !== null, h4: h4 ? h4.textContent : '' };
})()`);

async function assertLessonShown(page, label) {
  const s = await lessonState(page);
  assert.equal(s.hidden, false, `${label}: the lesson section is not hidden (${JSON.stringify(s)})`);
  assert.notEqual(s.display, 'none', `${label}: the lesson section is displayed (${JSON.stringify(s)})`);
  assert.equal(s.offsetParent, true, `${label}: the lesson section takes up room on screen (${JSON.stringify(s)})`);
  assert.notEqual(s.h4, '', `${label}: the lesson shows a step heading (${JSON.stringify(s)})`);
}

const clickButton = (page, scope, text) => page.evaluate(`(() => {
  const b = Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find((x) => x.textContent === ${JSON.stringify(text)});
  if (!b) throw new Error('no button "${text}" in ${scope}');
  b.click();
})()`);

const heading = (page) => page.evaluate("(document.getElementById('songsPracticeHeading') || {}).textContent || ''");
// Remembers the lesson heading now on screen (if any); the next wait is for a different, new one.
const markHeading = (page) => page.evaluate('window.__hMark = document.getElementById("songsPracticeHeading")');
const waitNewHeading = (page) => page.waitFor("(() => { const h = document.getElementById('songsPracticeHeading'); return !!h && h !== window.__hMark && h.textContent !== ''; })()", 20000);

async function openSongsPanel(page) {
  await page.evaluate('document.querySelector(\'#mainNav button[data-route="songs"]\').click()');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
}

// The titles of every row in the Songs list.
const rowTitles = (page) => page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)");

// The stored songs, with their keys (IndexedDB bandcoach-songs, store kv).
const readStore = (page) => page.evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open('bandcoach-songs', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const tx = db.transaction('kv', 'readonly'); const st = tx.objectStore('kv');
  const keys = await new Promise((res) => { const q = st.getAllKeys(); q.onsuccess = () => res(q.result); });
  const out = [];
  for (const k of keys) if (String(k).startsWith('song:')) out.push({ key: String(k), value: await new Promise((res) => { const q = st.get(k); q.onsuccess = () => res(q.result); }) });
  db.close();
  return out;
})()`);

const firstMidi = (song) => song.parts[0].notes[0].midi;

// Edit notes on the starter, move the whole song up an octave, Save to my songs, Practise this.
async function copyUpAnOctaveAndPractise(page) {
  await openSongsPanel(page);
  await clickButton(page, '.panel-songs-row button', TITLE);
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
  await clickButton(page, '.panel-songs-song-actions button', 'Edit notes');
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor(`document.getElementById('editorTitle').value === ${JSON.stringify(COPY_TITLE)}`);
  await clickButton(page, '#panelHost button', 'Whole song up an octave');
  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");
  await page.waitFor("document.getElementById('editorPractiseBtn') && !document.getElementById('editorPractiseBtn').hidden");
  await markHeading(page);
  await page.evaluate("document.getElementById('editorPractiseBtn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await waitNewHeading(page);
}

test('T1: Practise this, after saving an edited copy of a starter, opens the copy', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await copyUpAnOctaveAndPractise(page);
  assert.equal(await heading(page), COPY_TITLE, 'Practise this opens the learner\'s copy, not the shipped starter');
  await assertLessonShown(page, 'Practise this on a starter copy');
  const stored = await readStore(page);
  assert.ok(stored.length >= 1, 'the copy was stored');
  assert.ok(!stored.some((s) => s.key === 'song:hot-cross-buns'), 'no stored key is song:hot-cross-buns: ' + stored.map((s) => s.key).join(', '));
  const copy = stored.find((s) => s.value.title === COPY_TITLE);
  assert.ok(copy, 'the stored copy is titled "' + COPY_TITLE + '": ' + stored.map((s) => s.value.title).join(', '));
  const starterFirst = firstMidi(starterSongs.find((x) => x.id === 'hot-cross-buns'));
  assert.equal(firstMidi(copy.value), starterFirst + 12, 'the stored copy is the edited one (first note an octave above the starter\'s ' + starterFirst + ')');
  assert.deepEqual(page.exceptions, []);
});

test('T2: control: the starter row still opens the starter, before and after a copy exists', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await openSongsPanel(page);
  await markHeading(page);
  await clickButton(page, '.panel-songs-row button', TITLE);
  await waitNewHeading(page);
  assert.equal(await heading(page), TITLE, 'with no copy, the starter row opens the starter');

  await copyUpAnOctaveAndPractise(page);
  await page.evaluate('document.querySelector(\'#mainNav button[data-route="practice"]\').click()');
  await page.waitFor("window.__coach.panelOpen() === null");
  await openSongsPanel(page);
  // The library rows load after the starter rows; wait for the list to finish before reading it.
  await page.waitFor(`Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === ${JSON.stringify(COPY_TITLE)})`, 20000).catch(() => {});
  const rows = await rowTitles(page);
  assert.ok(rows.includes(TITLE), 'the starter row is still listed: ' + rows.join(' | '));
  assert.ok(rows.includes(COPY_TITLE), 'the copy has its own row: ' + rows.join(' | '));
  await markHeading(page);
  await clickButton(page, '.panel-songs-row button', TITLE);
  await waitNewHeading(page);
  assert.equal(await heading(page), TITLE, 'with a copy saved, the starter row still opens the starter');
  assert.deepEqual(page.exceptions, []);
});

test('T3: "Save a copy" on a starter stores it under its own key, and its row opens it', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await openSongsPanel(page);
  await clickButton(page, '.panel-songs-row button', TITLE);
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
  await clickButton(page, '.panel-songs-song-actions button', 'Save a copy');
  await page.waitFor(`Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === ${JSON.stringify(TITLE + ' (copy)')})`);
  const stored = await readStore(page);
  assert.equal(stored.length, 1, 'exactly one song stored: ' + stored.map((s) => s.key).join(', '));
  assert.ok(!stored.some((s) => s.key === 'song:hot-cross-buns'), 'no stored key is song:hot-cross-buns: ' + stored.map((s) => s.key).join(', '));
  await markHeading(page);
  await clickButton(page, '.panel-songs-row button', TITLE + ' (copy)');
  await waitNewHeading(page);
  assert.equal(await heading(page), TITLE + ' (copy)', 'the copy row opens the copy');
  assert.deepEqual(page.exceptions, []);
});

test('T4: Carry on, after practising a starter copy, offers the copy', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await copyUpAnOctaveAndPractise(page);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await clickButton(page, '.panel-songs-practice button', 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Watch and listen')");
  await clickButton(page, '.panel-songs-practice button', 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  await page.evaluate('document.querySelector(\'#mainNav button[data-route="practice"]\').click()');
  await page.waitFor("window.__coach.panelOpen() === null");
  await page.evaluate('document.querySelector(\'#mainNav button[data-route="songs"]\').click()');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor("document.querySelector('.panel-songs-carry-on') && !document.querySelector('.panel-songs-carry-on').hidden");
  const label = await page.evaluate("document.querySelector('.panel-songs-carry-on').textContent");
  assert.equal(label, 'Carry on: ' + COPY_TITLE);
  assert.deepEqual(page.exceptions, []);
});
