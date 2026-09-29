// window.__coach.songsNoteAt(midi, offsetSec) delivers a song-practice note
// stamped at an exact audio-clock offset from the attempt's own start
// (songs.js recordStartSec()), not at whatever moment the call happens to
// run. A test driving a TIMED check step (rhythm, tempo ladder) can then
// play "the note at t=0" with zero lateness even on a loaded runner, which
// the older songsNote() -- stamped with api.now() at call time -- cannot
// promise (G-flaky-under-load-3: songs-session-log "acc 0.78, expected 1").
//
// Proof: start the rhythm step, wait well past any timing tolerance, THEN
// deliver the note stamped at offset 0. The step must pass exactly as if the
// note had been played on the first beat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';

function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1', title: 'One Note', from: null, note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-at', title: 'One Note At', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

const BTN = (label) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(label)})`;
const TITLE = "document.querySelector('.panel-songs-practice h4').textContent";

test('songsNoteAt stamps a late-delivered note at the attempt start, so a timed step still passes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-note-at-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note At'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note At')).click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  // listen step -> Next; the next step is the timed rhythm check.
  await page.waitFor(`!!${BTN('Next')}`);
  await page.evaluate(`${BTN('Next')}.click()`);
  await skipDemo(page);
  await page.waitFor(`!!${BTN('Your turn')}`);
  const rhythmTitle = await page.evaluate(TITLE);

  await page.evaluate(`${BTN('Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  // Far later than any rhythm tolerance: a note stamped "now" would fail.
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate('window.__coach.songsNoteAt(64, 0)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(`${BTN('Stop and check')}.click()`);
  await page.waitFor(`${TITLE} !== ${JSON.stringify(rhythmTitle)}`);

  assert.notEqual(await page.evaluate(TITLE), rhythmTitle, 'the rhythm step passed and the lesson moved on');
  assert.deepEqual(page.exceptions, []);
});
