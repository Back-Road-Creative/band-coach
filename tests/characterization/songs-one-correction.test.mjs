// R1V2: a check-phase step's SECOND consecutive miss on the SAME thing still
// drops into the repair loop (tests/characterization/songs-repair.test.mjs
// covers that hand-off), but the repair itself now isolates exactly the ONE
// worst note (src/core/teaching.js repairFor), not a handful padded with
// neighbours -- and every repair try is logged as an assistance:'guided'
// learning-event row (src/core/learning-events.js ASSISTANCE), since a
// repair try is never independent evidence. Same pattern as
// songs-repair.test.mjs: drives the built page through
// window.__coach.openPanel('songs') and the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';

const htmlPath = HTML_PATH;

const PHRASE_MIDI = [64, 62, 60];

// Same absolute-clock attempt helper as songs-repair.test.mjs -- see that
// file for why an absolute t0 + cumulative delay is used instead of chained
// relative setTimeouts. `notes` (default the whole phrase) lets a caller
// play only a PREFIX of the phrase -- exactly what a single-note repair
// needs to be proven: the SAME 3-midi phrase, but only its first note
// played, either passes (repair truly isolated one note) or fails on a
// missing-note miss (repair still expects more than one).
async function playAttempt(page, delaysMs, notes = PHRASE_MIDI) {
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
        const seq = ${JSON.stringify(notes)}.map((midi, i) => { cumMs += delays[i]; return { midi, at: t0 + cumMs / 1000 }; });
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

test('repair isolates exactly ONE note (a single-note attempt passes it) and logs it as guided assistance', async (t) => {
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

  // phrase-slow (a check-phase step): fail it twice in a row, same dim
  // (pitch, every note missed) both times, to drop into repair.
  await playAttempt(page, null);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await playAttempt(page, null);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Fix one thing')"
  );

  const eventsBeforeRepairTry = await page.evaluate("window.__coach.db().events.length");

  // Play only the FIRST note of the phrase -- if the repair still isolated
  // more than one note this reads as a missed note and fails (extras/hitRate
  // stay too low to pass); if it isolated exactly one, this is a clean,
  // complete attempt and passes straight back to the phrase-slow step.
  await playAttempt(page, [50], [PHRASE_MIDI[0]]);
  await page.waitFor(
    "document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"
  );
  const backTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(backTitle.startsWith('Play it slowly'), 'a single-note attempt did not clear the repair: ' + backTitle);

  // The repair try itself logged one learning-event row, assistance
  // 'guided' -- a repair retry is never independent evidence (plan 6.4,
  // src/core/learning-events.js ASSISTANCE/isIndependentOk).
  const events = await page.evaluate('window.__coach.db().events');
  const newEvents = events.slice(eventsBeforeRepairTry);
  const repairRow = newEvents.find((e) => typeof e.skill === 'string' && e.skill.indexOf('repair:') === 0);
  assert.ok(repairRow, 'no learning-event row logged for the repair try; got skills: ' + newEvents.map((e) => e.skill).join(', '));
  assert.equal(repairRow.assistance, 'guided');

  assert.deepEqual(page.exceptions, []);
});
