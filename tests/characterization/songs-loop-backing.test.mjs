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
async function playAttempt(page, delaysMs) {
  const script = `
    (async () => {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      if (turnBtn) turnBtn.click();
      const seq = ${JSON.stringify(PHRASE_MIDI.map((midi, i) => ({ midi, delayMs: delaysMs[i] })))};
      for (const { midi, delayMs } of seq) {
        await new Promise(r => setTimeout(r, delayMs));
        window.__coach.songsNote(midi, true);
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
