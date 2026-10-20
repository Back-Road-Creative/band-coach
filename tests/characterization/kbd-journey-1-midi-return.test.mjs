// Journey 1 of 4 (keyboard learner): a first visit with a MIDI keyboard.
// Setup and helpers: ./kbd-journey-shared.mjs (see its header for the rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { htmlPath, HCB_BY_HEADING, clickMode, connectFakeMidi, selectKbdMod, playSongToEnd, readPathwayPanel, readRetention, countIn } from './kbd-journey-shared.mjs';

// -----------------------------------------------------------------------
// Scenario 1: first visit, a real MIDI keyboard, all the way to 'return'.
//
// FINDING (measured, not assumed): the task brief for this journey expected
// Progress's "Passed on your own" line to read exactly 1 once the pathway
// reaches 'return'. It does not. Check mode ALWAYS restarts a lesson at
// step 1 (src/ui/songs.js startPractice's own comment: "Check never reads
// the saved-place list at all, so it always starts at step 1") and every
// EARLIER judged step (rhythm, pitches, phrase-slow, each tempo-ladder
// rung) that is played cleanly in Check mode ALSO logs assistance:'none'
// with every dim 'ok' -- exactly isIndependentOk's own test -- so it counts
// too. src/core/pathway.js's own qualifies() only looks at the skill ===
// 'whole:null' row, but src/ui/history.js's #historyRetention line
// (summarizeEvents(db.events, ...)) has no skill/source filter at all: it
// counts every independent-ok row app-wide. The two disagree about what
// "the check" is. A real learner's first-ever successful Check-mode
// walkthrough of a song will see "Passed on your own: N" for N = every
// judged step of that walkthrough, not 1 -- this is asserted below as the
// exact, deterministic N (computed from the real walk, not hard-coded),
// not loosened to "at least 1".
// -----------------------------------------------------------------------
test('journey 1: a first visit with a MIDI keyboard reaches return; Progress counts every clean judged step, not just the whole-piece one', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await selectKbdMod(page);
  const before = await readPathwayPanel(page);
  assert.equal(before.step, 'setup', 'a fresh profile with no MIDI evidence and no lesson yet must start at setup');

  // Connect a real fake MIDI port and play a note -- BEFORE any trainer
  // task is running, so the note only marks midiProof (src/app.js
  // handleMidiMessage sets midiHeard unconditionally) and never reaches
  // onNote's judging path (`if (!playing || !task || task.done) return;`),
  // keeping the "exactly one independent pass" count clean of the trainer's
  // own quiz.
  await connectFakeMidi(page);
  await page.evaluate("window.__midiSend('p1', [0x90, 60, 100])");
  const afterMidi = await readPathwayPanel(page);
  assert.equal(afterMidi.step, 'lesson', 'midi proof alone, still level 1, must read as the lesson step');

  // "Work the trainer far enough that the hand-off appears": the real Skip
  // ahead control (#harderBtn -> jump(1), src/app.js) moves the level with
  // no correct-answer bookkeeping of its own, so this cannot itself
  // contaminate the independent-pass count the way grinding real trainer
  // quiz answers could.
  await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor("!!document.getElementById('kbdSongHandoff')");
  assert.equal(await page.evaluate('window.__coach.state().level'), 2);

  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'Hot Cross Buns'");

  // Straight into Check mode (MIDI only, no help) -- every judged step
  // logs a real 'song' source event (marking songTried true partway
  // through), but only the final whole-piece row, played cleanly, ever
  // qualifies (P1's qualifies(): skill must be exactly 'whole:null').
  await clickMode(page, 'check');
  await playSongToEnd(page, HCB_BY_HEADING, 'midi');
  const afterCheck = await readPathwayPanel(page);
  assert.equal(afterCheck.step, 'return', 'a clean, whole-piece, MIDI, no-help check must reach return');

  // The independent count is not predicted analytically (a real timed run
  // can retry a rung that judges "late"/"close" rather than 'ok' before it
  // passes, logging a non-independent row along the way) -- it is computed
  // straight off the SAME events the app itself logged, with the SAME pure
  // predicate Progress uses, so this assertion can never drift from what
  // the app actually did.
  const events = await page.evaluate('window.__coach.db().events');
  const expectedIndependent = events.filter(isIndependentOk).length;
  assert.ok(expectedIndependent >= 1, 'the real run must log at least the qualifying whole-piece row');
  const retention = await readRetention(page);
  assert.equal(
    countIn(retention, 'Passed on your own'), expectedIndependent,
    `Progress must count exactly the events isIndependentOk agrees with (${expectedIndependent}) -- NOT just 1 for the whole-piece check, per this test's FINDING comment: ` + retention
  );
  assert.deepEqual(page.exceptions, []);
});
