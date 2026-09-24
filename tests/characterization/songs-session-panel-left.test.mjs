// Leaving the Songs panel early (switching to another panel) after at
// least one judged step still logs that practice as a session row --
// src/ui/songs.js's hide() -- so "I judged a step or two, then bailed out"
// counts toward today's minutes the same way finishing the lesson does
// (tests/characterization/songs-session-log.test.mjs). Switches panels
// through the REAL picker buttons (#panelPicker), not the __coach hook, so
// this proves the shipped click path, not just the debug shortcut.
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

test('leaving the Songs panel after a judged step logs exactly one session row, and finishing nothing more does not add another', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-panel-left-'));
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

  // The listen step judges nothing (passRule: null) -- step past it with
  // Next, then judge exactly ONE real step (the rhythm step) before leaving.
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
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

  assert.equal(await page.evaluate('window.__coach.db().sessions.length'), 0, 'sanity check: no session logged yet, mid-lesson');

  // Leave the Songs panel through the real panel picker (not the __coach
  // hook), the same click path a learner uses.
  await page.evaluate("document.querySelector('#panelPicker button[data-panel=\"ear\"]').click()");
  await page.waitFor('window.__coach.db().sessions.length > 0');

  const afterLeave = await page.evaluate('window.__coach.db().sessions');
  assert.equal(afterLeave.length, 1, 'exactly one session row logged on leaving the panel early');
  assert.equal(afterLeave[0].source, 'song');
  assert.equal(afterLeave[0].mod, 'kbd');
  assert.equal(afterLeave[0].songId, 'one-note-song');

  // "finishing nothing more" -- no further judging happens, so nothing else
  // should ever add a second row for this same, already-logged practice.
  const stillOne = await page.evaluate('window.__coach.db().sessions');
  assert.equal(stillOne.length, 1, 'no second row appears once the session was already logged');
  assert.deepEqual(page.exceptions, []);
});
