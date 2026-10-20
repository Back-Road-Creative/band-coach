// Journey 3 of 4 (keyboard learner): the next day, a real recheck is retained.
// Setup and helpers: ./kbd-journey-shared.mjs (see its header for the rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT } from '../helpers/fake-midi.mjs';
import { summarizeEvents } from '../../src/core/learning-events.js';
import { KBD_SONG_SKILL_MAP } from '../../src/instruments/kbd-songs.js';
import { htmlPath, DATE_OFFSET_INIT, advanceOneDay, HCB_BY_HEADING, clickMode, connectFakeMidi, selectKbdMod, playSongToEnd, readPathwayPanel, clickPathwayAction, readRetention, countIn } from './kbd-journey-shared.mjs';

// -----------------------------------------------------------------------
// Scenario 3: a learner returns the next day and rechecks. Day 1 reaches
// 'return' exactly like Scenario 1; the pathway then offers 'wait' (not
// 'recheck') until a day has actually passed (src/core/pathway.js's own
// `now < dueAt` branch). Date.now() is patched, not the event data --
// DATE_OFFSET_INIT adds a localStorage-held offset that survives a real
// page.reload(), so "day 2" is the same profile, one real day later, not a
// hand-seeded row. Real song events already carry a genuine epoch-ms `at`
// today (src/core/learning-events.js's makeEvent defaults to Date.now();
// src/ui/songs.js's own call passes no `now` override -- see that call's
// comment) even though the `## Keyboard pathway (contract)` section above
// still flags a mixed-clock caveat against an OLDER state of the code; this
// journey is live proof the caveat no longer applies to a fresh check row.
// -----------------------------------------------------------------------
test('journey 3: a learner returns the next day and a real recheck is retained', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT + DATE_OFFSET_INIT });
  t.after(() => page.close());

  await selectKbdMod(page);
  await connectFakeMidi(page);
  await page.evaluate("window.__midiSend('p1', [0x90, 60, 100])");
  await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor("!!document.getElementById('kbdSongHandoff')");
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");
  await clickMode(page, 'check');
  await playSongToEnd(page, HCB_BY_HEADING, 'midi');

  const day1 = await readPathwayPanel(page);
  assert.equal(day1.step, 'return', 'day 1: a clean whole-piece MIDI check must reach return');
  assert.equal(day1.wait, true, 'day 1: return must offer to wait, not a recheck, before a day has passed');
  assert.equal(day1.retained, false, 'day 1: nothing has been retained yet');

  await advanceOneDay(page);
  // The fake MIDI port does not survive a real navigation (a fresh document
  // gets a fresh, empty fake port list from FAKE_MIDI_INIT) -- a returning
  // learner reconnects their keyboard, same as day 1's own connectFakeMidi.
  await connectFakeMidi(page);

  const day2 = await readPathwayPanel(page);
  assert.equal(day2.step, 'return', 'day 2, before rechecking: still return');
  assert.equal(day2.wait, false, 'day 2: a day has genuinely passed, so return must no longer say wait');
  assert.ok(day2.hasAction, 'day 2: return must now offer a real action (recheck)');

  // The panel's own recheck action opens the song straight into Check mode
  // (src/ui/pathway.js: `(kind === 'check-song' || kind === 'recheck') &&
  // song` both call requestOpenSong(..., 'check')) -- no manual mode switch
  // needed, unlike Scenario 2's route back into Check.
  await clickPathwayAction(page);
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').getAttribute('aria-pressed') === 'true'");
  await playSongToEnd(page, HCB_BY_HEADING, 'midi');

  const afterRecheck = await readPathwayPanel(page);
  assert.equal(afterRecheck.retained, true, 'a clean recheck at or after dueAt must read as retained');
  assert.notEqual(afterRecheck.step, 'complete', 'retained alone (no transfer song played) must not reach complete');

  // Ground truth for the Progress "Remembered on a later try" bucket: the
  // SAME summarizeEvents() call #historyRetention itself makes
  // (src/ui/history.js), on the SAME real events -- never a hand-predicted
  // number, for the same reason Scenario 1's independent count is not one.
  const events = await page.evaluate('window.__coach.db().events');
  const expected = summarizeEvents(events, { skillMap: KBD_SONG_SKILL_MAP, skillMapInstrument: 'kbd' });
  assert.ok(expected.retained >= 1, 'the real two-day run must log at least one retained row');
  const retention = await readRetention(page);
  assert.equal(
    countIn(retention, 'Remembered on a later try'), expected.retained,
    `Progress must count exactly what summarizeEvents agrees with (${expected.retained}): ` + retention
  );
  assert.deepEqual(page.exceptions, []);
});
