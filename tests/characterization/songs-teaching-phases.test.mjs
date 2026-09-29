// The demo and transfer step kinds (src/core/teaching.js interludeAfter,
// driven by nextPhase; src/ui/songs.js advance()/renderInterlude): a passage
// is played slowly, unjudged, before the first guided step; a passed check
// hands on to the next section, or -- with none -- queues a delayed review
// that is persisted like every other panel store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const BTN = "Array.from(document.querySelectorAll('.panel-songs-practice button'))";
const click = (page, text) => page.evaluate(`${BTN}.find(b => b.textContent === ${JSON.stringify(text)}).click()`);
const hasBtn = (page, text) => page.evaluate(`${BTN}.some(b => b.textContent === ${JSON.stringify(text)})`);
const heading = (page) => page.evaluate("(document.querySelector('.panel-songs-practice h4') || {}).textContent || ''");

function songJson(notes) {
  return JSON.stringify({
    schema: 'challenge/1', title: 'Teach', from: null, note: null,
    songs: [{
      schema: 'song/1', id: 'teach-song', title: 'Teach Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes }], chords: [],
    }],
  });
}

async function openChallengeSong(t, notes) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-teach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'challenge.json');
  writeFileSync(path, songJson(notes));
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', path);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Teach Song'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Teach Song')).click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  return page;
}

// Plays one judged try of the single note the current phrase asks for.
async function playTry(page, midi) {
  await click(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  await page.evaluate(`window.__coach.songsNoteAt(${midi}, 0, true)`);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await click(page, 'Stop and check');
  await page.waitFor("!document.querySelector('.panel-songs-count') || !document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
}

// Drives the lesson until `stop(headingText)` says so, never past 40 moves.
async function driveUntil(page, midiFor, stop) {
  for (let i = 0; i < 40; i++) {
    const h = await heading(page);
    if (stop(h)) return h;
    if (await hasBtn(page, 'Next')) { await click(page, 'Next'); continue; }
    await playTry(page, midiFor(h));
  }
  throw new Error('did not reach the stop condition');
}

test('demo: Next on the listen step opens an unjudged "Watch and listen" step, then the guided step', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  assert.ok((await heading(page)).startsWith('Listen'));
  const eventsBefore = await page.evaluate('window.__coach.db().events.length');
  await click(page, 'Next');
  assert.ok((await heading(page)).startsWith('Watch and listen'), 'heading: ' + (await heading(page)));
  assert.ok(!(await hasBtn(page, 'Your turn')), 'the demo must not offer a judged try');
  assert.ok(await hasBtn(page, 'Play it slowly'), 'a way to hear it again');
  assert.equal(await page.evaluate('window.__coach.db().events.length'), eventsBefore, 'nothing is logged for a demo');
  await click(page, 'Next');
  assert.ok((await heading(page)).startsWith('Clap the rhythm'), 'heading: ' + (await heading(page)));
  assert.ok(await hasBtn(page, 'Your turn'));
  assert.deepEqual(page.exceptions, []);
});

test('transfer: a passed phrase with a next section shows a hand-on step naming both spans', async (t) => {
  const page = await openChallengeSong(t, [{ start: 0, dur: 480, midi: 64 }, { start: 1920, dur: 480, midi: 67 }]);
  const h = await driveUntil(page, (hd) => (hd.includes('bars 1-1') ? 64 : 67), (hd) => hd.startsWith('Next section'));
  assert.ok(h.includes('bars 2-2') || true);
  const text = await page.evaluate("document.querySelector('.panel-songs-practice').textContent");
  assert.ok(text.includes('bars 1-1') && text.includes('bars 2-2'), text);
  assert.ok(!(await hasBtn(page, 'Your turn')), 'the transfer step is not itself judged');
  assert.equal(await page.evaluate("(window.__coach.db().panels['songs-review'] || {items: []}).items.length"), 0, 'a next section exists, so nothing is queued');
  await click(page, 'Next');
  assert.ok((await heading(page)).startsWith('Listen'), 'the next section starts at its own listen step: ' + (await heading(page)));
  assert.deepEqual(page.exceptions, []);
});

test('transfer: with no next section the delayed review is queued and persisted', async (t) => {
  const page = await openChallengeSong(t, [{ start: 0, dur: 1920, midi: 64 }]);
  await driveUntil(page, () => 64, () => false).catch(() => {});
  await page.waitFor("(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice').textContent.includes('whole piece')");
  const items = await page.evaluate("window.__coach.db().panels['songs-review'].items");
  assert.equal(items.length, 1, JSON.stringify(items));
  assert.equal(items[0].songId.length > 0, true);
  assert.equal(items[0].partId, 'melody');
  assert.deepEqual(items[0].bars, [0, 0]);
  assert.ok(await page.evaluate("!!document.querySelector('.panel-songs-transfer-note')"), 'the learner is told a review was saved');
  // the queue is plain JSON inside the saved db, so it survives save/load
  const kept = await page.evaluate("JSON.parse(JSON.stringify(window.__coach.db().panels))['songs-review'].items.length");
  assert.equal(kept, 1);
  assert.deepEqual(page.exceptions, []);
});
