// Repair loop (plan §7B unit B2): a check-phase step's SECOND consecutive
// fail on the SAME thing drops into a short repair exercise on just the
// failing notes, instead of a third run at the whole phrase. Drives the
// built page through window.__coach.openPanel('songs') and the DOM,
// following the same pattern as tests/characterization/songs-loop-backing.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';

const htmlPath = HTML_PATH;

const PHRASE_MIDI = [64, 62, 60];

// Waits for the count-in to finish (real listening has begun -- see N2's
// count-in in src/ui/songs.js startRecording) before either playing the
// given notes or, when delaysMs is null, playing nothing at all -- a clean
// miss, deterministic every time (hitRate 0, no matches at all).
//
// Each note's gap is scheduled off an ABSOLUTE target on the app's own audio
// clock (t0 + the cumulative delay), not a chained `setTimeout(delayMs)`
// relative to the previous note. Chained relative timers compound: if one
// timer fires late (a starved runner delays Chromium's own JS thread same as
// anyone else's), every later note inherits that lateness AND adds its own,
// so the last note in a phrase can land arbitrarily later than intended. An
// absolute target makes every note's lateness independent and bounded by the
// polling interval alone (the `keyAt`/`grooveInject` pattern in
// tests/unit/drum-kit-trainer.test.mjs and src/app.js's debug hook) -- same
// delaysMs input, same notes, only how the wait is expressed changes.
//
// t0 itself is read from window.__coach.songsRecordStart(), the app's own
// practice.recordStartSec (src/ui/songs.js), not sampled by polling the DOM
// for "recording has begun" and then calling audioNow(): that samples a
// moment close to, but never exactly, the instant the app already computed,
// and a busy runner widens the gap between the two.
async function playAttempt(page, delaysMs) {
  const script = `
    (async () => {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      if (turnBtn) turnBtn.click();
      while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
        await new Promise(r => setTimeout(r, 4));
      }
      const delays = ${JSON.stringify(delaysMs)};
      if (delays) {
        const t0 = window.__coach.songsRecordStart();
        let cumMs = 0;
        const seq = ${JSON.stringify(PHRASE_MIDI)}.map((midi, i) => { cumMs += delays[i]; return { midi, at: t0 + cumMs / 1000 }; });
        for (const { midi, at } of seq) {
          await new Promise(resolve => {
            const fire = () => { if (window.__coach.audioNow() >= at) { window.__coach.songsNote(midi, true); resolve(); } else setTimeout(fire, 4); };
            fire();
          });
        }
      }
      await new Promise(r => setTimeout(r, 80));
      const stopBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check');
      if (stopBtn) stopBtn.click();
      return true;
    })()
  `;
  await page.evaluate(script);
}

test('a check step failed twice on the same thing drops into a repair, and passing it returns to the phrase', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

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
  await skipDemo(page);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  // rhythm (100bpm, quarter = 600ms): a clean attempt passes it.
  await playAttempt(page, [50, 600, 600]);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  // pitches step: untimed, any spacing passes.
  await playAttempt(page, [50, 100, 100]);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"
  );

  // phrase-slow (a check-phase step): fail it twice in a row by playing
  // nothing at all both times -- a clean miss every note, same dim (pitch)
  // both tries.
  await playAttempt(page, null);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await playAttempt(page, null);

  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Fix one thing')"
  );
  const repairTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(repairTitle.startsWith('Fix one thing'), 'unexpected title: ' + repairTitle);
  const instructionText = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice p')).map(p => p.textContent).find(t => t.includes('Just these notes'))"
  );
  assert.equal(instructionText, 'Just these notes, then back to the phrase.');

  // Passing the repair (R1V2: the repair now isolates exactly the single
  // worst note -- every note here missed the same way, so "worst" falls
  // back to the first one broken in the phrase, PHRASE_MIDI[0]) returns to
  // the phrase-slow step it isolated from.
  const script = `
    (async () => {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      if (turnBtn) turnBtn.click();
      while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
        await new Promise(r => setTimeout(r, 4));
      }
      const t0 = window.__coach.songsRecordStart();
      const at = t0 + 50 / 1000;
      await new Promise(resolve => {
        const fire = () => { if (window.__coach.audioNow() >= at) { window.__coach.songsNote(${PHRASE_MIDI[0]}, true); resolve(); } else setTimeout(fire, 4); };
        fire();
      });
      await new Promise(r => setTimeout(r, 80));
      const stopBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check');
      if (stopBtn) stopBtn.click();
      return true;
    })()
  `;
  await page.evaluate(script);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"
  );
  const backTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(backTitle.startsWith('Play it slowly'), 'did not return to the phrase-slow step: ' + backTitle);
  assert.deepEqual(page.exceptions, []);
});
