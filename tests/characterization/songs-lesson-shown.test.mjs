// Every way into a song lesson puts the lesson on screen. The lesson section
// (.panel-songs-practice) is created hidden (src/ui/songs.js) and openSong()
// un-hides it for a row click; the hand-offs (keyboard button, pathway panel,
// capture's "Make it a lesson", the editor's "Practise this", the add-song
// review's cards and button) skip openSong() and go through startPractice(),
// which must un-hide it too, or the learner sees a song title and no lesson.
// window.__coach is used for setup only; every hand-off is a real click.
// The pathway panel's song, check, recheck and transfer actions are all covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { playHotCrossBunsToTheEnd } from '../helpers/play-hot-cross-buns.mjs';

const htmlPath = HTML_PATH;

// What a learner can see of the lesson section (observation only).
const lessonState = (page) => page.evaluate(`(() => {
  const s = document.querySelector('.panel-songs-practice');
  const h = document.getElementById('songsPracticeHeading');
  const h4 = s && s.querySelector('h4');
  return { hidden: s.hidden, display: getComputedStyle(s).display, offsetParent: s.offsetParent !== null, heading: h && h.textContent, h4: h4 ? h4.textContent : '' };
})()`);

const headingIs = (title) => `(document.getElementById('songsPracticeHeading') || {}).textContent === ${JSON.stringify(title)}`;
const headingMatches = (re) => `${re}.test((document.getElementById('songsPracticeHeading') || {}).textContent || '')`;

async function assertLessonShown(page, label) {
  const s = await lessonState(page);
  assert.equal(s.hidden, false, `${label}: the lesson section is not hidden (${JSON.stringify(s)})`);
  assert.notEqual(s.display, 'none', `${label}: the lesson section is displayed (${JSON.stringify(s)})`);
  assert.equal(s.offsetParent, true, `${label}: the lesson section takes up room on screen (${JSON.stringify(s)})`);
  assert.notEqual(s.h4, '', `${label}: the lesson shows a step heading (${JSON.stringify(s)})`);
}

// A keyboard learner at level 2, as kbd-practice-song-handoff.test.mjs seeds it.
async function seedKbdHandoff(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("window.__coach.setMod('kbd')");
}

const DAY_MS = 24 * 60 * 60 * 1000;
// A qualifying whole-song row (the shape src/ui/songs.js writes for an independent
// play), agoMs before the seed; the page turns agoMs into `at` from its own clock.
const wholeRow = (id, songId, agoMs) => ({ v: 1, id, agoMs, instrument: 'kbd', skill: 'whole:null', source: 'song', songId, assistance: 'none', dims: { pitch: 'ok', onset: 'ok' }, unassessed: ['hold', 'tune'], activeMs: 1000, input: 'midi' });

// The pathway panel's "song", "check", "recheck" or "transfer" step, as kbd-pathway-panel.test.mjs seeds it.
async function seedPathway(page, withSession, extraRows = []) {
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.level = 2;
    db.events = (db.events || []).concat([{ v: 1, id: 'seed-midi', at: Date.now() - 60000, instrument: 'kbd', skill: 'C4', source: 'drill', assistance: 'shown', dims: { pitch: 'ok' }, unassessed: [], activeMs: 0, input: 'midi' }]);
    ${extraRows.length ? `db.events = db.events.concat(${JSON.stringify(extraRows)}.map((r) => { const { agoMs, ...e } = r; return { ...e, at: Date.now() - agoMs }; }));` : ''}
    ${withSession ? "db.sessions = (db.sessions || []).concat([{ d: '2020-01-01', mod: 'kbd', min: 5, acc: 1, a1: 1, a2: 1, from: 2, to: 2, breaks: 0, source: 'song', songId: 'hot-cross-buns' }]);" : ''}
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("document.getElementById('pathwayAction')");
}

// Opens the editor on a copy of Hot Cross Buns, saves it, and presses "Practise this".
async function practiseFromEditor(page) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Edit notes').click()");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor("document.getElementById('editorTitle').value === 'My copy of Hot Cross Buns'");
  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");
  await page.waitFor("document.getElementById('editorPractiseBtn') && !document.getElementById('editorPractiseBtn').hidden");
  await page.evaluate("document.getElementById('editorPractiseBtn').click()");
}

// An ABC import through the Add a song file door, up to its review screen.
async function importAbc(t, page, abc) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-lesson-shown-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'tune.abc');
  writeFileSync(path, abc, 'utf8');
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");
  await page.evaluate("Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()");
  await page.setFileInput('#songsFileInput', path);
  await page.waitFor("document.querySelector('.panel-learn-result').hidden === false", 20000);
}

const ABC_HANDOFF = 'X:1\nT:Handoff Test\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n';
// A Q: tempo so it imports with no warnings and "Practise this" is enabled.
const ABC_CLEAN = 'X:1\nT:Clean Review Test\nM:4/4\nL:1/8\nQ:120\nK:C\nCDEFGABc|\n';

test('control: a song-row click shows the lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate('document.querySelector(\'#mainNav button[data-route="songs"]\').click()');
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await assertLessonShown(page, 'song-row click');
  assert.deepEqual(page.exceptions, []);
});

test('keyboard hand-off: "Play a song with these notes" shows the lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedKbdHandoff(page);
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await assertLessonShown(page, 'keyboard hand-off');
  assert.deepEqual(page.exceptions, []);
});

test('pathway panel, song step: the action shows the lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedPathway(page, false);
  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await assertLessonShown(page, 'pathway open-song');
  assert.deepEqual(page.exceptions, []);
});

test('pathway panel, check step: the action shows the lesson in Check mode', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedPathway(page, true);
  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]')");
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed')"), 'true', 'Check mode is the pressed mode');
  await assertLessonShown(page, 'pathway check-song');
  assert.deepEqual(page.exceptions, []);
});

// What the panel's current step and notes say before the action is pressed (reads only).
const pathwayRead = (page) => page.evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  const cur = document.querySelectorAll('.pathway-steps li[aria-current="step"]');
  return { current: cur.length === 1 ? cur[0].dataset.step : 'count:' + cur.length, wait: !!q('.pathway-wait'), retained: !!q('.pathway-retained'), transfer: !!q('.pathway-transfer'), action: q('#pathwayAction').textContent };
})()`);
const checkModePressed = async (page) => {
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]')");
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed')"), 'true', 'Check mode is the pressed mode');
};

test('pathway panel, recheck step: the action shows the lesson in Check mode', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedPathway(page, false, [wholeRow('seed-check', 'hot-cross-buns', DAY_MS + 60000)]);
  const s = await pathwayRead(page);
  assert.equal(s.current, 'return', 'recheck seed: the current step is return');
  assert.equal(s.wait, false, 'recheck seed: no wait note');
  assert.equal(s.retained, false, 'recheck seed: no retained note (a recheck, not a transfer offer)');
  assert.equal(s.transfer, false, 'recheck seed: no transfer note');
  assert.equal(s.action, 'Check Hot Cross Buns in Songs', 'recheck seed: the action names the song');
  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await checkModePressed(page);
  await assertLessonShown(page, 'pathway recheck');
  assert.deepEqual(page.exceptions, []);
});

test('pathway panel, transfer step: the action shows the transfer song\'s lesson in Check mode', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedPathway(page, false, [wholeRow('seed-check', 'hot-cross-buns', 2 * DAY_MS), wholeRow('seed-retained', 'hot-cross-buns', 60000)]);
  const s = await pathwayRead(page);
  assert.equal(s.current, 'return', 'transfer seed: the current step is return');
  assert.equal(s.retained, true, 'transfer seed: the retained note is shown');
  assert.equal(s.transfer, true, 'transfer seed: the transfer note is shown');
  assert.equal(s.wait, false, 'transfer seed: no wait note');
  assert.equal(s.action, 'Check Au clair de la lune in Songs', 'transfer seed: the action names the transfer song');
  await page.evaluate("document.getElementById('pathwayAction').click()");
  await page.waitFor(headingIs('Au clair de la lune'));
  await checkModePressed(page);
  await assertLessonShown(page, 'pathway transfer');
  assert.deepEqual(page.exceptions, []);
});

test('capture "Make it a lesson" shows the lesson for the captured tune', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('capture')");
  await page.evaluate("window.__coach.cap().notes.push({ m: 60, t: 0, d: 0.4 }, { m: 62, t: 0.5, d: 0.4 }, { m: 64, t: 1.0, d: 0.4 })");
  await page.waitFor("document.getElementById('capUse')");
  await page.evaluate("document.getElementById('capUse').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'", 20000);
  await page.waitFor(headingMatches('/^Captured tune \\d{4}-\\d{2}-\\d{2}$/'), 20000);
  await assertLessonShown(page, 'capture Make it a lesson');
  assert.deepEqual(page.exceptions, []);
});

test('editor "Practise this" shows the lesson for the song just saved', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  // A song of the learner's own (an ABC import), not a copy of a starter: this test is about
  // the lesson being shown. A saved starter copy has its own id and "Practise this" opens it
  // (tests/characterization/songs-starter-copy.test.mjs).
  await importAbc(t, page, ABC_CLEAN);
  await page.evaluate("document.querySelector('.panel-learn-fixitup-btn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor("document.getElementById('editorTitle') && document.getElementById('editorTitle').value === 'Clean Review Test'", 10000);
  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-saved-status').textContent === 'Saved'");
  await page.waitFor("!document.getElementById('editorPractiseBtn').hidden");
  await page.evaluate("document.getElementById('editorPractiseBtn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor(headingIs('Clean Review Test'), 20000);
  await assertLessonShown(page, 'editor Practise this');
  assert.deepEqual(page.exceptions, []);
});

test('review "Play it on…" card shows the lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await importAbc(t, page, ABC_HANDOFF);
  await page.evaluate("document.querySelector('.panel-learn-result .panel-songs-instrument-btn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  await page.waitFor(headingIs('Handoff Test'), 20000);
  await assertLessonShown(page, 'review Play it on card');
  assert.deepEqual(page.exceptions, []);
});

test('review "Practise this" button shows the lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await importAbc(t, page, ABC_CLEAN);
  assert.equal(await page.evaluate("document.querySelector('.panel-learn-practise-btn').disabled"), false, 'Practise this is enabled for a clean import');
  await page.evaluate("document.querySelector('.panel-learn-practise-btn').click()");
  await page.waitFor(headingIs('Clean Review Test'), 20000);
  await assertLessonShown(page, 'review Practise this');
  assert.deepEqual(page.exceptions, []);
});

test('a hand-off with no instrument picked shows the "pick an instrument" sentence', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  // Capture is a tool, not an instrument, so the editor's request (which names none) has no instrument to use.
  await page.evaluate("window.__coach.setMod('capture')");
  await practiseFromEditor(page);
  await page.waitFor("window.__coach.panelOpen() === 'songs'");
  const SENTENCE = 'Pick an instrument on the main screen first, then come back here to practise.';
  await page.waitFor(`Array.from(document.querySelectorAll('.panel-songs-practice p')).some(p => p.textContent === ${JSON.stringify(SENTENCE)})`, 20000);
  const s = await lessonState(page);
  assert.equal(s.hidden, false, `the sentence is not hidden (${JSON.stringify(s)})`);
  assert.notEqual(s.display, 'none', `the sentence is displayed (${JSON.stringify(s)})`);
  assert.equal(s.offsetParent, true, `the sentence takes up room on screen (${JSON.stringify(s)})`);
  assert.deepEqual(page.exceptions, []);
});

test('"Back to songs" at the end of a hand-off lesson hides the lesson and opens the library', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await seedKbdHandoff(page);
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor(headingIs('Hot Cross Buns'));
  await playHotCrossBunsToTheEnd(page);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Back to songs')", 15000);
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Back to songs').click()");
  const s = await lessonState(page);
  assert.equal(s.hidden, true, `the lesson section is hidden again (${JSON.stringify(s)})`);
  assert.equal(s.display, 'none');
  assert.equal(await page.evaluate("document.querySelector('details.panel-songs-library').open"), true, 'the library is open again');
  assert.deepEqual(page.exceptions, []);
});
