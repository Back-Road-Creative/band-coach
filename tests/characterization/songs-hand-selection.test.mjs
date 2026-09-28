// A two-hand keyboard song lesson (the "both hands" starters, and any
// imported score whose notes carry note.hand) shows a Hands control (Both /
// Right / Left) and judges only the chosen hand -- src/ui/songs.js's
// handSplit(), src/song/hand-filter.js's stepForHands(). Drives real fake-MIDI
// input (tests/helpers/fake-midi.mjs), never the debug hook, so this proves
// the shipped app, not just its internals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

function rhThenBothChallengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'Hands',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'rh-then-both', title: 'Right Then Both', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{
        id: 'piano', name: 'Piano', notes: [
          { start: 0, dur: 1920, midi: 64, hand: 'rh' },
          { start: 1920, dur: 1920, midi: 64, hand: 'rh' },
          { start: 1920, dur: 1920, midi: 48, hand: 'lh' },
        ],
      }],
      chords: [],
    }],
  });
}

async function openStarterByTitle(page, title) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === ${JSON.stringify(title)}).click()`
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function importAndOpenChallengeSong(page, challengePath, songTitle) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes(${JSON.stringify(songTitle)}))`
  );
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes(${JSON.stringify(songTitle)})).click()`
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function clickNext(page) {
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
}

async function judgeFirstStepWith(page, sendNoteJs) {
  await page.evaluate(`(async () => {
    const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
    if (turnBtn) turnBtn.click();
    while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
      await new Promise(r => setTimeout(r, 4));
    }
    ${sendNoteJs}
  })()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
}

test('a two-hand starter judges only the left hand over MIDI and logs hands "left"', async (t) => {
  // The judged step is a "Clap the rhythm" (timed) step -- a real fake-MIDI
  // send's wall-clock arrival relative to the phrase's own count-in can miss
  // a loaded runner's timing window even when the app is behaving correctly
  // (same caveat tests/helpers/songs-note.mjs documents), so the send-and-
  // judge portion alone is retried independently, same pattern as
  // songs-input-route.test.mjs's mic test.
  const result = await retryFlaky({
    attempts: 3,
    what: 'a two-hand starter judging only the chosen hand over real fake-MIDI input',
    describe: (r) => 'said: ' + JSON.stringify(r.said) + ', row: ' + JSON.stringify(r.row),
    accept: (r) => r.said === 'Nice. 1 of 1 notes.',
    attempt: async () => {
      const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
      try {
        await openStarterByTitle(page, 'Ode to Joy (theme), both hands');

        // RED at c3c520a: no .panel-songs-hands element exists yet.
        const both = await page.evaluate("(document.querySelector('.panel-songs-hands button[data-hands=\"both\"]') || {}).getAttribute && document.querySelector('.panel-songs-hands button[data-hands=\"both\"]').getAttribute('aria-pressed')");
        assert.equal(both, 'true', 'Both hands is the default selection');
        const hasRight = await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"right\"]') !== null");
        const hasLeft = await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]') !== null");
        assert.ok(hasRight && hasLeft, 'a Right hand and Left hand button both exist');

        await midiAddPort(page, 'p1', 'Test Keys');
        await page.evaluate("document.getElementById('ioBtn').click()");
        await page.waitFor("document.getElementById('ioBtn').hidden === true");

        await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').click()");
        await page.waitFor("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').getAttribute('aria-pressed') === 'true'");

        const prepText = await page.evaluate("document.querySelector('.panel-songs-hands-prep').textContent");
        assert.equal(prepText, 'Left hand starts on C3.');

        await clickNext(page);
        const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
        assert.ok(stepTitle.startsWith('Clap the rhythm'), 'landed on the first judged step: ' + stepTitle);

        const before = await page.evaluate('window.__coach.db().events.length');
        await judgeFirstStepWith(page, "window.__midiSend('p1', [0x90, 48, 100]);");
        const gotEvent = await page
          .waitFor('window.__coach.db().events.length > ' + before, 5000)
          .then(() => true)
          .catch(() => false);
        const said = await page.evaluate("document.getElementById('panelSay').textContent");
        if (!gotEvent) return { said, row: null, exceptions: page.exceptions.slice() };

        const events = await page.evaluate('window.__coach.db().events');
        const row = events[events.length - 1];
        return { said, row, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });

  assert.equal(result.said, 'Nice. 1 of 1 notes.');
  assert.equal(result.row.source, 'song');
  assert.equal(result.row.skill, 'rhythm:0');
  assert.equal(result.row.hands, 'left');
  assert.equal(result.row.input, 'midi');
  assert.deepEqual(result.exceptions, []);
});

test('a step with no left-hand notes is not assessed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-hands-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, rhThenBothChallengeJson());

  // The final judged step is timed ("Clap the rhythm") -- retried
  // independently for the same wall-clock reason as the test above.
  const result = await retryFlaky({
    attempts: 3,
    what: 'a rest step logging nothing and the first real judged step logging one row',
    describe: (r) => JSON.stringify(r),
    accept: (r) => r.newRowLogged && r.restSeenAndClean,
    attempt: async () => {
      const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
      try {
        await importAndOpenChallengeSong(page, challengePath, 'Right Then Both');

        await midiAddPort(page, 'p1', 'Test Keys');
        await page.evaluate("document.getElementById('ioBtn').click()");
        await page.waitFor("document.getElementById('ioBtn').hidden === true");

        await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').click()");
        await page.waitFor("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').getAttribute('aria-pressed') === 'true'");

        const before = await page.evaluate('window.__coach.db().events.length');
        let sawRest = false;
        let restClean = true;
        for (let i = 0; i < 12; i++) {
          const hasTurn = await page.evaluate(
            "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
          );
          if (hasTurn) break;
          const restVisible = await page.evaluate("document.querySelector('.panel-songs-hands-rest') !== null");
          if (restVisible) sawRest = true;
          const count = await page.evaluate('window.__coach.db().events.length');
          if (count !== before) restClean = false;
          await clickNext(page);
        }
        const restSeenAndClean = sawRest && restClean;

        const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
        assert.ok(stepTitle.includes('(bars 2-2)'), 'landed on bar 2: ' + stepTitle);
        assert.ok(stepTitle.startsWith('Clap the rhythm'), 'first judged step is a rhythm step: ' + stepTitle);

        await judgeFirstStepWith(page, "window.__midiSend('p1', [0x90, 48, 100]);");
        const newRowLogged = await page
          .waitFor('window.__coach.db().events.length > ' + before, 5000)
          .then(() => true)
          .catch(() => false);
        const events = await page.evaluate('window.__coach.db().events');
        const row = newRowLogged ? events[events.length - 1] : null;
        return { restSeenAndClean, newRowLogged, before, rowCount: events.length, row, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });

  assert.ok(result.restSeenAndClean, 'the rest line showed and no row was logged while skipping it');
  assert.ok(result.newRowLogged, 'a new row was logged on the first real judged step');
  assert.equal(result.rowCount, result.before + 1, 'exactly one new row was logged on the first real judged step');
  assert.equal(result.row.hands, 'left');
  assert.equal(result.row.skill, 'rhythm:1');
  assert.deepEqual(result.exceptions, []);
});

test('melody-only starters show no hand selector', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const title of ['Hot Cross Buns', 'Frère Jacques']) {
    await openStarterByTitle(page, title);
    const hasHands = await page.evaluate("document.querySelector('.panel-songs-hands') !== null");
    const hasPrep = await page.evaluate("document.querySelector('.panel-songs-hands-prep') !== null");
    assert.equal(hasHands, false, title + ' shows no hand selector');
    assert.equal(hasPrep, false, title + ' shows no hand prep line');
  }

  assert.deepEqual(page.exceptions, []);
});

test('a left-hand lesson resumes as left hand after a reload', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await openStarterByTitle(page, 'Ode to Joy (theme), both hands');
  await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').click()");
  await page.waitFor("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').getAttribute('aria-pressed') === 'true'");
  await clickNext(page);
  await page.waitFor(
    "(() => { try { const e = JSON.parse(localStorage.getItem('bandcoach.v1')).panels.songs.lessons[0]; return e.key.setup.endsWith('|hands=left') && e.stepIndex === 1; } catch (e) { return false; } })()"
  );

  await page.reload();
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Ode to Joy (theme), both hands').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Clap the rhythm'), 'resumed on the step it was left on: ' + stepTitle);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.equal(said, 'Picking up where you left off.');
  const leftPressed = await page.evaluate("document.querySelector('.panel-songs-hands button[data-hands=\"left\"]').getAttribute('aria-pressed')");
  assert.equal(leftPressed, 'true');

  assert.deepEqual(page.exceptions, []);
});
