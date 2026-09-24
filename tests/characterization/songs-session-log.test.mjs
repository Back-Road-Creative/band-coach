// A finished song lesson leaves its own row in DB.sessions, the same way a
// built-in drill's endSession() does (fix/song-progress-contract), so
// "today's minutes", day streak and "last session" all count song
// practice too. Drives the built page through a one-note custom song (a
// teacher "challenge" import, same technique as
// tests/characterization/songs-hold-tune.test.mjs) on keyboard, so every
// judged step can be driven through window.__coach.songsNote() with no
// fake microphone -- see src/ui/songs.js's "Note capture during practice"
// header comment for why that only works for a MIDI-input instrument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// One phrase, one note, starting at tick 0 (the very start of the phrase's
// own clock -- src/song/lesson.js/practice.js's phraseSec()): every step of
// the lesson this generates (rhythm, pitches, phrase-slow, the tempo
// ladder, the whole piece) expects this note at t=0, so firing
// window.__coach.songsNote() in the SAME browser tick as the "Your turn"
// click keeps the timing error near zero regardless of the step's own bpm
// or duration tolerance -- no need to predict or wait out any of them.
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

test('finishing a song lesson logs a practice session with source: "song"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-session-'));
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

  const before = await page.evaluate('window.__coach.db().sessions.length');

  // Walk the whole lesson through to its end: Next on the listen step,
  // otherwise start the recording and play the note in the SAME tick, then
  // stop and check.
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
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
    );
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
    ); // N2 (#191): a four-beat count-in runs before listening starts; a note during it is ignored
    await page.evaluate(
      "window.__coach.songsNote(64, true)"
    );
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
    );
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }

  await page.waitFor('window.__coach.db().sessions.length > ' + before);
  const sessions = await page.evaluate('window.__coach.db().sessions');
  assert.equal(sessions.length, before + 1, 'exactly one session row logged for the whole lesson');
  const row = sessions[sessions.length - 1];
  assert.equal(row.mod, 'kbd');
  assert.equal(row.source, 'song');
  assert.equal(row.songId, 'one-note-song');
  assert.equal(row.acc, 1, 'every judged step in this lesson was answered correctly');
  assert.deepEqual(page.exceptions, []);
});
