// Songs panel (src/ui/songs.js): switching songs mid-recording, and a
// listen step's stale bar-by-bar result. Drives the built page through
// window.__coach.openPanel('songs') and the DOM, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { writeBandPack } from '../../src/song/band-pack.js';

const htmlPath = HTML_PATH;

test('opening a different song while recording stops the old song\'s listener, instead of leaving it running unseen', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-switch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packPath = join(dir, 'switch-target.bandpack');
  // A two-part song, so openSong() takes the "show a list of parts" branch
  // (song.parts.length > 1) instead of auto-starting a practice session --
  // the branch that never called stopRecording() (finding 1).
  writeFileSync(packPath, writeBandPack({
    name: 'Switch Target Pack',
    songs: [{
      schema: 'song/1', id: 'switch-target', title: 'Switch Target', composer: null, licence: null, source: null,
      key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480,
      parts: [
        { id: 'a', name: 'Part A', notes: [] },
        { id: 'b', name: 'Part B', notes: [] },
      ],
      chords: [],
    }],
  }));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );
  // "Your turn" now opens with a four-beat count-in before it actually
  // starts listening (N2) -- wait for that to finish (the count element
  // switches from "Counting in…" to "Notes heard so far: 0") before playing
  // a note, or it would land during the clicks and never be heard at all.
  await page.waitFor(
    "document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );

  // Keep a live JS reference to the count element -- once the panel is
  // rebuilt to show the OTHER song's part list, this node is detached from
  // the document (so document.querySelector can no longer find it), but the
  // songs module's own `countEl` closure variable still points at the exact
  // same node: it is only ever reset by renderPractice(), which openSong()'s
  // buggy multi-part branch never calls. If the old recording's listener is
  // still subscribed, its next note keeps writing into this detached node.
  await page.evaluate("window.__leakNode = document.querySelector('.panel-songs-count')");
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("window.__leakNode.textContent.includes('1')");

  await page.setFileInput('#songsFileInput', packPath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Switch Target')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Switch Target').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Practise: Part A')"
  );

  // No Stop button is left anywhere -- but with the old listener still
  // subscribed, a note played now silently keeps feeding the orphaned
  // recording (finding 1), invisible on screen only because its node is no
  // longer in the document.
  await page.evaluate('window.__coach.songsNote(65, true)');
  // Give the (buggy) listener a moment to run before reading the result.
  await page.evaluate('new Promise(r => setTimeout(r, 50))');

  const leaked = await page.evaluate('window.__leakNode.textContent');
  assert.equal(
    leaked,
    'Notes heard so far: 1',
    'opening the two-part song should have stopped the old recording, so a later note must not still be counted into it: ' + leaked
  );
  assert.deepEqual(page.exceptions, []);
});

// A single note, precisely at song-absolute tick 0, so buildLessonPlan's
// per-phrase steps all expect it played at t=0 of the attempt no matter
// their own bpm -- every one of phrase 0's timed pass rules is satisfiable
// by pressing the key the instant recording starts, with no artificial wait.
// A long rest (a whole beat) before the second note forces segment() to cut
// a second, separate phrase, whose own listen step is what finding 2 is
// about.
function stripTestSong() {
  return {
    schema: 'song/1', id: 'strip-test-song', title: 'Strip Test Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 240, midi: 60 },
        { start: 2000, dur: 240, midi: 62 },
      ],
    }],
    chords: [],
  };
}

test('a listen step\'s "Next" does not carry a stale bar-by-bar result onto the next, unattempted step', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-strip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packPath = join(dir, 'strip-test.bandpack');
  writeFileSync(packPath, writeBandPack({ name: 'Strip Test Pack', songs: [stripTestSong()] }));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', packPath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent === 'Strip Test Song')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Strip Test Song').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  // First listen step (phrase 0) -- move straight past it.
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );

  // Pass every one of phrase 0's steps (bars 1-1) by pressing the phrase's
  // one note (midi 60) the instant "Your turn" starts recording -- clicking
  // and pressing the note in one evaluate call so no round trip can push the
  // played timestamp past the tighter tempo-ladder pass rules.
  for (let i = 0; i < 10; i++) {
    const title = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
    if (title.includes('bars 2-2')) break; // reached phrase 1's own listen step
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
    );
    // Wait out the four-beat count-in (N2) -- pressing the note the instant
    // "Your turn" is clicked would now land during the clicks and never be
    // heard, so this waits for the count element to say real listening has
    // begun before pressing the phrase's one note.
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
    );
    await page.evaluate('window.__coach.songsNote(60, true)');
    await page.waitFor(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
    );
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
    );
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }

  const arrivedTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(arrivedTitle.startsWith('Listen') && arrivedTitle.includes('bars 2-2'), 'reached phrase 1\'s listen step: ' + arrivedTitle);
  // The just-earned bar strip from phrase 0's last attempt is expected here.
  assert.ok(
    await page.evaluate("document.querySelector('.panel-songs-bar-strip') !== null"),
    'the freshly-earned bar strip is shown on the listen step that follows the attempt that earned it'
  );

  // Advance past the listen step -- passRule: null, nothing judged here.
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const strip = await page.evaluate("document.querySelector('.panel-songs-bar-strip')");
  assert.equal(
    strip,
    null,
    'phrase 0\'s bar strip must not still be showing on phrase 1\'s first step, which nobody has attempted yet'
  );
  assert.deepEqual(page.exceptions, []);
});
