// Songs panel tempo-ladder wiring (Wave E, unit E1): a tempo-ladder step's
// loop-backing transport (src/ui/songs/loop-backing.js, wrapping the
// already-written but previously unconnected src/audio/stretch/loop.js
// "Riff Repeater" ladder) shows the learner the current playback rate in
// plain words, and a missed attempt steps it down. Drives the built page
// through window.__coach.openPanel('songs') and the DOM, following the same
// pattern as tests/characterization/w-songs.test.mjs and songs-heat.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

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

async function getToFirstTempoLadderStep(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  // listen step: just Next.
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  // rhythm (100bpm, quarter = 600ms): offsets 0, 600, 1200ms; a small
  // constant lead added to every note keeps the MEAN error near that
  // constant (well under 120ms) instead of accumulating.
  await playAttempt(page, [50, 600, 600]);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  // pitches step: untimed (order only), any spacing passes.
  await playAttempt(page, [50, 100, 100]);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  // phrase-slow (55bpm, quarter ~1091ms): offsets 0, 1091, 2182ms.
  await playAttempt(page, [50, 1091, 1091]);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it up to speed')"
  );
}

test('a tempo-ladder step shows the current playback rate in plain words, starting at full speed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await getToFirstTempoLadderStep(page);

  const rateText = await page.evaluate("document.querySelector('.panel-songs-rate').textContent");
  assert.equal(rateText, 'Full speed');
  assert.deepEqual(page.exceptions, []);
});

test('a missed attempt on the tempo-ladder step drops the shown rate below full speed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await getToFirstTempoLadderStep(page);

  // A clean miss: start the try and stop it again with nothing played.
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-rate')");

  const rateText = await page.evaluate("document.querySelector('.panel-songs-rate').textContent");
  assert.notEqual(rateText, 'Full speed', 'the rate readout should drop after a missed attempt');
  assert.ok(rateText.startsWith('Playing at '), 'unexpected rate text: ' + rateText);
  assert.deepEqual(page.exceptions, []);
});

// A starved runner fires the page's short timers late. That lateness must
// never reach a note's timestamp, or a correct answer is judged late and the
// walk above never reaches the ladder step (seen in 3 of 50 full-suite runs
// on 2026-09-27: "waitFor timed out ... 'Play it up to speed'"). This makes
// the lateness certain instead of rare: every 4 ms timer in the page -- the
// polling interval playAttempt uses; the app has none on this path -- waits
// 254 ms instead.
const LATE_SHORT_TIMERS = `(() => {
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) { return orig.call(window, fn, ms === 4 ? 254 : ms, ...rest); };
})();`;

test('the walk still reaches the tempo-ladder step when the page runs its short timers late', async (t) => {
  const page = await launchPage(htmlPath, { initScript: LATE_SHORT_TIMERS });
  t.after(() => page.close());

  await getToFirstTempoLadderStep(page);

  const rateText = await page.evaluate("document.querySelector('.panel-songs-rate').textContent");
  assert.equal(rateText, 'Full speed');
  assert.deepEqual(page.exceptions, []);
});
