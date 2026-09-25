// Songs hears drums (P4-12): a percussion part gets kit notation instead of
// a pitched staff, "Play it" sounds real drum hits, and both an e-kit's own
// MIDI notes (window.__coach.songsNote, the same forwardNote() every other
// instrument's fixture uses) and a real kit through the microphone
// (window.__coach.testDrumHit, the SAME analyser chain openMic() uses --
// see tests/unit/drum-kit-mic.test.mjs) are heard while recording a try.
// Drives the built page through window.__coach.openPanel('songs') and a
// real .json challenge import (a percussion song has no place in the
// built-in library, so it is handed in the same way a teacher's challenge
// file is -- see tests/characterization/songs-challenge.test.mjs), then the
// DOM, following the same pattern as tests/characterization/songs-heat.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

function songJson(id, title, notes) {
  return {
    schema: 'song/1', id, title, composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes }],
    chords: [],
  };
}

// Kick@0, snare@480, kick@960, snare@1440 -- one bar of a basic beat, per
// the brief -- each note carrying both its GM percussion midi (36 = Bass
// Drum 1, 38 = Acoustic Snare) and the piece id playPhrase/judgeAttempt
// actually key off.
function kitChallengeJson() {
  return JSON.stringify({
    schema: 'challenge/1', title: 'Kit test',
    songs: [songJson('kit-song', 'Kit Song', [
      { start: 0, dur: 480, midi: 36, piece: 'kick' },
      { start: 480, dur: 480, midi: 38, piece: 'snare' },
      { start: 960, dur: 480, midi: 36, piece: 'kick' },
      { start: 1440, dur: 480, midi: 38, piece: 'snare' },
    ])],
  });
}

// A single tom hit -- 'tom-high' is in MIC_UNNAMEABLE (src/ui/songs/practice.js),
// so a mic hit here can never be marked right or wrong, only not-assessed.
function tomChallengeJson() {
  return JSON.stringify({
    schema: 'challenge/1', title: 'Tom test',
    songs: [songJson('tom-song', 'Tom Song', [
      { start: 0, dur: 480, midi: 50, piece: 'tom-high' },
    ])],
  });
}

async function importChallenge(page, json, songTitle) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-drums-'));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, json);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes(${JSON.stringify(songTitle)}))`
  );
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes(${JSON.stringify(songTitle)})).click()`
  );
  rmSync(dir, { recursive: true, force: true });
}

// Clicks through any leading no-passRule steps (e.g. "Listen") to the first
// step with a "Your turn" button, clicks it, and waits out the four-beat
// count-in -- same pattern as tests/characterization/songs-heat.test.mjs's
// getToRecordingStep.
async function getToRecording(page) {
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  while (!(await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  ))) {
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
    );
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );
}

test('a drum part shows kit notation', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('drum-kit')");
  await importChallenge(page, kitChallengeJson(), 'Kit Song');

  await page.waitFor('document.querySelector(\'.panel-songs-view[data-view="kit"] canvas[aria-label]\')');
  const label = await page.evaluate('document.querySelector(\'.panel-songs-view[data-view="kit"] canvas\').getAttribute(\'aria-label\')');
  assert.match(label, /percussion staff/);
  assert.deepEqual(page.exceptions, []);
});

test("an e-kit's hits are heard in Songs", async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('drum-kit')");
  await importChallenge(page, kitChallengeJson(), 'Kit Song');
  await getToRecording(page);

  await page.evaluate('window.__coach.songsNote(36, true)'); // 36 = Bass Drum 1 -> kick
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");

  assert.deepEqual(page.exceptions, []);
});

test('a mic hit on a tom beat says which drum is not assessed', async (t) => {
  await retryFlaky({
    attempts: 3,
    what: 'a mic hit on a tom beat being marked not-assessed rather than a miss',
    accept: (ok) => ok,
    describe: (ok) => (ok ? 'not-assessed li found' : 'not-assessed li never appeared'),
    attempt: async () => {
      const page = await launchPage(htmlPath);
      try {
        await page.evaluate("window.__coach.setMod('drum-kit')");
        await importChallenge(page, tomChallengeJson(), 'Tom Song');
        await getToRecording(page);

        // A real kit (or a room mic) through the SAME analyser chain
        // openMic() uses -- see tests/unit/drum-kit-mic.test.mjs. The
        // classifier only tells kick/snare/hi-hat apart, so a 'snare'-shaped
        // hit against an expected tom is exactly the case the mic cannot
        // name either way -- it must not be judged right or wrong.
        await page.evaluate("window.__coach.testDrumHit([{ kind: 'snare', atMs: 0 }])");
        await new Promise((r) => setTimeout(r, 900));
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
        );

        return await page
          .waitFor('document.querySelector(\'.panel-songs-assessed li[data-dim="drum"][data-state="not-assessed"]\')', 5000)
          .then(() => true)
          .catch(() => false);
      } finally {
        await page.close();
      }
    },
  });
});
