// A logged song session's source/songId (src/ui/songs.js's logSession() call,
// see tests/characterization/songs-session-log.test.mjs) has to survive a
// real page reload -- sanitizeDB() (src/app.js) is the ONLY gate a saved
// DB.sessions row passes through on load, and until now it whitelisted only
// the fields a built-in drill's endSession() writes, silently dropping
// source/songId the moment the page reloaded even though they were sitting
// right there in localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Note',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-song', title: 'One Note Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

test('a song session row keeps its source and songId after the page reloads', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-persist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  for (let i = 0; i < 12; i++) {
    const finished = await page.evaluate(
      "(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice p').textContent.includes('whole piece')"
    );
    if (finished) break;
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (hasNext) {
      await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
      continue;
    }
    await page.evaluate(
      "(function () { Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click(); window.__coach.songsNote(64, true); })()"
    );
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
    );
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  await page.waitFor('window.__coach.db().sessions.length > 0');
  const before = await page.evaluate('window.__coach.db().sessions');
  assert.equal(before.length, 1);
  assert.equal(before[0].source, 'song', 'sanity check: the row is a song row before reload');

  await page.reload();
  await page.waitFor('window.__coach.db().sessions.length > 0');
  const after = await page.evaluate('window.__coach.db().sessions');
  assert.equal(after.length, 1, 'reload must not drop or duplicate the session row');
  assert.equal(after[0].source, 'song', 'source must survive sanitizeDB on reload');
  assert.equal(after[0].songId, 'one-note-song', 'songId must survive sanitizeDB on reload');
  assert.deepEqual(page.exceptions, []);
});
