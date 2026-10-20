// Journey 2 of 4 (keyboard learner): computer keys only never pass the check.
// Setup and helpers: ./kbd-journey-shared.mjs (see its header for the rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { htmlPath, DATE_OFFSET_INIT, HCB_BY_HEADING, clickButtonNamed, clickMode, connectFakeMidi, selectKbdMod, driveStepReal, playSongToEnd, readPathwayPanel, readRetention, countIn } from './kbd-journey-shared.mjs';

// One judged step, driven with real, timed computer-key presses, in Check
// mode -- proves P1's strict input==='midi' rule (src/core/learning-
// events.js isIndependentOk) the same way kbd-midi-check-path.test.mjs's C3
// does, but reached through a real practice session's own restart, not a
// standalone song import.
async function checkOneStepComputerKey(page, byHeading) {
  // The panel is already closed (the caller just read the pathway panel,
  // which lands back on the practice route via a real nav click, closing
  // Songs along with it -- src/ui/panels.js's close() unmounts the panel's
  // own DOM, so '.panel-songs-practice' is gone from the page entirely, not
  // just hidden). The real way back into a normal (non-finished) step view
  // is the same one a learner has: the keyboard hand-off button again,
  // which starts the lesson fresh at step 1 (Learn, the default) -- a
  // normal view where the mode-switcher's Check button is really on
  // screen (src/ui/songs.js renderPractice(): the finished-piece screen
  // returns early, before that group is built, so it is never present
  // there).
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]')");
  await clickMode(page, 'check');
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const hasNext = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')");
  if (hasNext) await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  const headingKey = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent.match(/^(.*\\(bars \\d+-\\d+\\))/)[1]");
  const notes = byHeading[headingKey][0];
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  await driveStepReal(page, notes, 'computer-key');
  await page.waitFor(`document.querySelector('.panel-songs-count').textContent.includes('${notes.length}')`);
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  return events[events.length - 1];
}

// -----------------------------------------------------------------------
// Scenario 2: the same route, but every note is a real computer-key press.
// Practice genuinely progresses (Learn, assistance 'shown'), and Check
// mode itself IS reached and driven -- but the pathway never reads
// 'return', and Progress never reads an independent pass, because P1's
// check rule is strict-MIDI for keyboard (src/core/learning-events.js
// isIndependentOk).
// -----------------------------------------------------------------------
test('journey 2: computer keys only never passes the check', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await selectKbdMod(page);
  await connectFakeMidi(page);
  // A real MIDI note before any task is active still establishes midiProof
  // (src/app.js handleMidiMessage) without logging a drill row -- the same
  // "connect a MIDI keyboard, then play everything else on the computer
  // keys" a real learner with both at hand might do; without SOME MIDI
  // evidence the pathway would never leave 'setup' at all (P1's hasProof),
  // which would make this scenario untestable through no fault of the
  // computer-key route itself.
  await page.evaluate("window.__midiSend('p1', [0x90, 60, 100])");

  await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor("!!document.getElementById('kbdSongHandoff')");
  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");

  // Learn (the default mode): every note a real computer-key press.
  await playSongToEnd(page, HCB_BY_HEADING, 'computer-key');
  const afterLearn = await readPathwayPanel(page);
  assert.notEqual(afterLearn.step, 'return', 'Learn-mode practice, however clean, must never reach return');
  assert.notEqual(afterLearn.step, 'complete', 'Learn-mode practice, however clean, must never reach complete');

  // Check mode itself, one judged step, computer keys: the disqualifying
  // route this scenario is actually about.
  const checkRow = await checkOneStepComputerKey(page, HCB_BY_HEADING);
  assert.equal(checkRow.input, 'computer-key');
  assert.equal(checkRow.assistance, 'none');
  assert.equal(isIndependentOk(checkRow), false, 'a computer-key Check row must never read independent-ok');

  const afterCheck = await readPathwayPanel(page);
  assert.notEqual(afterCheck.step, 'return', 'a computer-key check must never advance the pathway to return');
  assert.notEqual(afterCheck.step, 'complete', 'a computer-key check must never advance the pathway to complete');

  const events = await page.evaluate('window.__coach.db().events');
  assert.equal(events.filter(isIndependentOk).length, 0, 'no row in this whole journey may read independent-ok');
  const retention = await readRetention(page);
  assert.equal(countIn(retention, 'Passed on your own'), 0, 'Progress must never count a computer-key-only journey as independent: ' + retention);
  assert.ok(events.length > 0, 'practice still genuinely progressed and logged rows');
  assert.deepEqual(page.exceptions, []);
});
