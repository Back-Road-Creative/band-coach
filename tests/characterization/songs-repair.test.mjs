// Repair loop (plan §7B unit B2): a check-phase step's SECOND consecutive
// fail on the SAME thing drops into a short repair exercise on just the
// failing notes, instead of a third run at the whole phrase. Drives the
// built page through window.__coach.openPanel('songs') and the DOM,
// following the same pattern as tests/characterization/songs-loop-backing.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const PHRASE_MIDI = [64, 62, 60];

// Waits for the count-in to finish (real listening has begun -- see N2's
// count-in in src/ui/songs.js startRecording) before either playing the
// given notes or, when delaysMs is null, playing nothing at all -- a clean
// miss, deterministic every time (hitRate 0, no matches at all).
async function playAttempt(page, delaysMs) {
  const script = `
    (async () => {
      const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
      if (turnBtn) turnBtn.click();
      while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
        await new Promise(r => setTimeout(r, 15));
      }
      const delays = ${JSON.stringify(delaysMs)};
      if (delays) {
        const seq = ${JSON.stringify(PHRASE_MIDI)}.map((midi, i) => ({ midi, delayMs: delays[i] }));
        for (const { midi, delayMs } of seq) {
          await new Promise(r => setTimeout(r, delayMs));
          window.__coach.songsNote(midi, true);
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

  // Passing the repair (play every isolated note in order, well inside
  // tolerance) returns to the phrase-slow step it isolated from.
  await playAttempt(page, [50, 1091, 1091]);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"
  );
  const backTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(backTitle.startsWith('Play it slowly'), 'did not return to the phrase-slow step: ' + backTitle);
  assert.deepEqual(page.exceptions, []);
});
