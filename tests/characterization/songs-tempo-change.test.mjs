// Songs plays, counts in, captures and judges on one clock (P4-3): a step
// whose phrase crosses a tempoMap change now says so in plain words
// (src/ui/songs.js renderPractice's new p.panel-songs-tempo, driven by
// src/song/clock.js's createSongClock/changesBetween), and playback/capture/
// judging all read the same clock (playPhrase, finishRecording) instead of
// one flat bpm for the whole phrase -- so a take played in time with a
// tempo change inside the phrase still passes. Drives the built page
// through the real challenge-import path and window.__coach.songsNote, the
// same pattern as tests/characterization/songs-loop-backing.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// 4/4, bpm 120, one tempoMap change to 60bpm at tick 1920 -- exactly the
// start of bar 2 (0-indexed bar 1) at 480 ticks/quarter. One part, two bars
// of quarter C4s (midi 60): the first four quarters (bar 1) play at 120bpm
// (0.5s apart), the last four (bar 2) at 60bpm (1s apart) -- onsets land at
// 0, 0.5, 1, 1.5, 2.0, 3.0, 4.0, 5.0s from the phrase origin.
const TEMPO_CHANGE_TICK = 1920;
function tempoChangeChallengeJson() {
  const notes = [];
  for (let i = 0; i < 8; i++) notes.push({ start: i * 480, dur: 480, midi: 60 });
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'Tempo Change Challenge',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'tempo-change-song', title: 'Tempo Change Song', composer: null, licence: null, source: null,
      key: null, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
      tempoMap: [{ tick: TEMPO_CHANGE_TICK, bpm: 60 }],
      parts: [{ id: 'melody', name: 'Melody', notes }],
      chords: []
    }]
  });
}

test('a step whose phrase crosses a tempo change says so, in plain words', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tempo-change-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'tempo-change.json');
  writeFileSync(challengePath, tempoChangeChallengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Tempo Change Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Tempo Change Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  await page.waitFor(
    "document.querySelector('.panel-songs-tempo') && document.querySelector('.panel-songs-tempo').textContent.includes('60')"
  );

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while showing the tempo change');
});

// Clicks "Your turn" on the current (rhythm) step and, once the count-in has
// actually ended (a MutationObserver on .panel-songs-count, so this never
// races the count-in's own real-time click schedule), fires eight onsets
// timed to this challenge's own tempo change (0, 0.5, 1, 1.5, 2, 3, 4, 5s --
// see tempoChangeChallengeJson's header comment) and clicks "Stop and check"
// once they have all landed.
async function playInTimeWithTheTempoChange(page) {
  const script = `
    (function () {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      turnBtn.click();
      const countEl = document.querySelector('.panel-songs-count');
      return new Promise((resolve) => {
        let started = false;
        const obs = new MutationObserver(() => {
          if (started || !countEl.textContent.startsWith('Notes heard so far')) return;
          started = true;
          obs.disconnect();
          [0, 0.5, 1, 1.5, 2, 3, 4, 5].forEach((s) => {
            setTimeout(() => window.__coach.songsNote(60, true), s * 1000);
          });
          setTimeout(() => {
            const stopBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check');
            stopBtn.click();
            resolve(true);
          }, 5600);
        });
        obs.observe(countEl, { childList: true, subtree: true, characterData: true });
      });
    })()
  `;
  await page.evaluate(script);
}

test('notes played on the changing clock pass Clap the rhythm', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tempo-change-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'tempo-change.json');
  writeFileSync(challengePath, tempoChangeChallengeJson());

  const result = await retryFlaky({
    attempts: 3,
    what: 'a rhythm attempt in time with the tempo change passing',
    describe: (r) => r.title || r.error || 'no result',
    accept: (r) => r.ok,
    attempt: async () => {
      const page = await launchPage(htmlPath);
      try {
        await page.evaluate("window.__coach.setMod('kbd')");
        await page.evaluate("window.__coach.openPanel('songs')");
        await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
        await page.setFileInput('#songsFileInput', challengePath);
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Tempo Change Song'))"
        );
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Tempo Change Song')).click()"
        );
        await page.waitFor("document.querySelector('.panel-songs-practice h4')");

        // listen step: just Next.
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
        );
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
        );

        await playInTimeWithTheTempoChange(page);
        await page.waitFor(
          "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play the notes')"
        );
        const title = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
        return { ok: title.startsWith('Play the notes'), title, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.ok(result.title.startsWith('Play the notes'));
  assert.deepEqual(result.exceptions, []);
});

// N2's caveat (see brief-p4-3): a "pitches" step carries bpm 0/tempoScale 0
// (no tempo to time against), so the clock must never be handed to it --
// judgeAttempt would divide by clock.bpmAt(from) scaled by 0/bpmAt, i.e. a
// zero scale, and phraseSec would blow up. This still judges by ORDER alone
// after the clock change (unit P4-3's own change to finishRecording/
// playPhrase), same as before the clock existed at all.
test('an untimed (pitches) step still judges by order alone, unaffected by the clock', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-tempo-change-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'tempo-change.json');
  writeFileSync(challengePath, tempoChangeChallengeJson());

  const result = await retryFlaky({
    attempts: 3,
    what: 'the untimed pitches step passing by order alone, alongside a tempo change',
    describe: (r) => r.title || r.error || 'no result',
    accept: (r) => r.ok,
    attempt: async () => {
      const page = await launchPage(htmlPath);
      try {
        await page.evaluate("window.__coach.setMod('kbd')");
        await page.evaluate("window.__coach.openPanel('songs')");
        await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
        await page.setFileInput('#songsFileInput', challengePath);
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Tempo Change Song'))"
        );
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Tempo Change Song')).click()"
        );
        await page.waitFor("document.querySelector('.panel-songs-practice h4')");

        // listen -> rhythm: reuse the same clock-timed attempt as the
        // previous test so this step reliably passes without becoming a
        // second test of the rhythm step itself.
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
        );
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
        );
        await playInTimeWithTheTempoChange(page);
        await page.waitFor(
          "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play the notes, any speed')"
        );

        // pitches step: no timing check at all, so notes played close
        // together (order only) must still pass regardless of the tempo
        // change inside this same phrase.
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
        );
        await page.waitFor(
          "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
        );
        for (let i = 0; i < 8; i++) {
          await page.evaluate('window.__coach.songsNote(60, true)');
          await new Promise((r) => setTimeout(r, 20));
        }
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
        );
        await page.waitFor(
          "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"
        );
        const title = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
        return { ok: title.startsWith('Play it slowly'), title, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.ok(result.title.startsWith('Play it slowly'));
  assert.deepEqual(result.exceptions, []);
});
