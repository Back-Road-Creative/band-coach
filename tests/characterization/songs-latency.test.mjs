import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';

// Hot Cross Buns' first phrase is "E4:q D4:q C4:h" at the song's own 100bpm
// -- three notes, MIDI 64/62/60, starting at ticks 0/480/960 (one, then two,
// quarters in). Real per-note delays (ms) computed from that so a real
// wall-clock attempt lands well inside each step's own maxMeanErrorMs
// tolerance (rhythm 120ms, phrase-slow 150ms) even under CI jitter.
const PHRASE_MIDI = [64, 62, 60];
// Each note's timing is anchored on the app's OWN audio clock
// (window.__coach.songsRecordStart()/audioNow(), the same origin
// practice.recordStartSec judges against -- see src/app.js's debug-hook
// block and src/ui/songs.js's recordStartSec()), not on stacked
// `setTimeout(delayMs)` calls. Three sequential setTimeouts compound
// whatever the event loop's own scheduling jitter is on EACH one -- a
// starved runner delaying the first note's timer pushes every later
// note's fire time back too, and that drift accumulates across the whole
// phrase -- where polling an absolute audio-clock target self-corrects on
// every 4ms check regardless of how late the loop actually got to run it
// (reproduced 2026-09-27: 5/9 concurrency=20 attempts of this file never
// reached the tempo ladder step at all, stuck on a rhythm/phrase-slow step
// that a late note pushed outside its own timing tolerance).
// Polling still lost under heavy load (3 of 50 full-suite runs on
// 2026-09-27), because songsNote() stamps a note with the clock at the
// moment the call runs, and a starved page runs the 4ms check late. Each
// note now goes through songsNoteAt(midi, offset), stamped at its exact
// offset from the attempt's start however late the call itself runs -- the
// same fix as tests/helpers/songs-note.mjs. The poll stays so notes still
// arrive in order and never ahead of their own time.
async function playAttempt(page, delaysMs) {
  const script = `
    (async () => {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      if (turnBtn) turnBtn.click();
      // "Your turn" now opens with a four-beat count-in (N2) before it
      // starts listening -- wait for the count element to say real
      // listening has begun before reading recordStartSec below.
      while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
        await new Promise(r => setTimeout(r, 4));
      }
      const recordStart = window.__coach.songsRecordStart();
      const seq = ${JSON.stringify(PHRASE_MIDI.map((midi, i) => ({ midi, delayMs: delaysMs[i] })))};
      let cumMs = 0;
      for (const { midi, delayMs } of seq) {
        cumMs += delayMs;
        const targetSec = recordStart + cumMs / 1000;
        while (window.__coach.audioNow() < targetSec) {
          await new Promise(r => setTimeout(r, 4));
        }
        window.__coach.songsNoteAt(midi, cumMs / 1000, true);
      }
      await new Promise(r => setTimeout(r, 80));
      const stopBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check');
      if (stopBtn) stopBtn.click();
      return true;
    })()
  `;
  await page.evaluate(script);
}


const BTNS = "Array.from(document.querySelectorAll('.panel-songs-practice button'))";
const H4 = "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent";

async function getToRhythmStep(page, latencyMs) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.db().latencyMs = ' + latencyMs);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(BTNS + ".find(b => b.textContent === 'Next').click()");
  await skipDemo(page);
  await page.waitFor(BTNS + ".some(b => b.textContent === 'Your turn')");
}

test('with a stored offset the line shows and a late-by-the-offset attempt passes', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await getToRhythmStep(page, 200);
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-latency').textContent"), 'Timing adjusted by 200 ms for your setup.');
  await playAttempt(page, [250, 600, 600]);
  await page.waitFor("(" + H4 + ").startsWith('Play the notes')", 8000);
  assert.deepEqual(page.exceptions, []);
});

test('with no stored offset there is no line and a late attempt does not pass', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await getToRhythmStep(page, 0);
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-latency')"), null);
  await playAttempt(page, [250, 600, 600]);
  await page.waitFor(BTNS + ".some(b => b.textContent === 'Your turn')");
  assert.ok(!(await page.evaluate(H4)).startsWith('Play the notes'));
  assert.deepEqual(page.exceptions, []);
});
