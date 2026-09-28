// Four end-to-end keyboard-learner journeys, driven through real entry
// points only (clicks, Tab+Enter, real fake-MIDI messages, real
// KeyboardEvents) -- never window.__coach for a journey STEP, per
// docs/journeys.md lines 1-6. window.__coach is used only to READ state for
// assertions (db(), audioNow(), songsRecordStart(), cur().info -- the one
// thing no real entry point can be asked for) or, where an existing suite
// already established the pattern (kbd-hand-alone-gate.test.mjs), to read a
// mastery item's own numbers. This file imports pathwayState() directly
// (src/core/pathway.js) only where a plain UI read cannot say which
// *action* a pathway step offers as precisely as the pure function can; the
// STEP itself is always read off the real "Your keyboard path" panel.
//
// Mutation-based red-first evidence (see this file's header comment; run
// order and exact commands recorded again in the hand-back):
//   Mutation A -- src/core/learning-events.js isIndependentOk(): loosen the
//     kbd-only strict-midi clause (`ev.input !== 'midi'`) to also accept
//     'computer-key'. Scenario 2 must fail, because its whole point is that
//     a computer-key-only check never counts.
//   Mutation B -- remove the starter-song hand-off fallback in src/app.js
//     (the `if (mod === 'kbd') { const song = songFor(S.level); ... }`
//     block that renders #kbdSongHandoff). Scenario 1 must fail, because it
//     cannot reach the song without that button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';
import { isIndependentOk, summarizeEvents } from '../../src/core/learning-events.js';
import { KBD_SONG_SKILL_MAP } from '../../src/instruments/kbd-songs.js';

const htmlPath = HTML_PATH;
const DAY_MS = 24 * 3600 * 1000;

// Patches Date.now() (only) to add an offset read from localStorage, so a
// day-2 "reload" can be simulated on the SAME page/profile without hand-
// seeding any event row -- day-1 rows all come from real clicks/MIDI, day 2
// only moves the clock. Re-injected fresh on every new document
// (Page.addScriptToEvaluateOnNewDocument), so it survives page.reload();
// the offset itself survives because it lives in localStorage, real
// browser storage, not a JS global.
const DATE_OFFSET_INIT = `
  (function () {
    const orig = Date.now.bind(Date);
    Date.now = function () { return orig() + Number(localStorage.getItem('__dayOffsetMs') || '0'); };
  })();
`;

async function advanceOneDay(page) {
  await page.evaluate(`localStorage.setItem('__dayOffsetMs', '${DAY_MS}')`);
  await page.reload();
}

// midi -> physical-key letter, src/core/pckeys.js's PCKEYS map inverted --
// only the notes Hot Cross Buns actually uses (C4/D4/E4) need to resolve,
// but the whole map is kept so a future song swap does not silently drop a
// note.
const PCKEYS_INV = {
  60: 'a', 61: 'w', 62: 's', 63: 'e', 64: 'd', 65: 'f', 66: 't', 67: 'g', 68: 'y', 69: 'h', 70: 'u', 71: 'j', 72: 'k',
  48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b', 57: 'n', 59: 'm',
};

// Same STEP_WORDS/heading-key shape tests/characterization/kbd-practice-
// song-handoff.test.mjs's HOT_CROSS_BUNS_STEPS_BY_HEADING builds, computed
// once against the real starter song and the real buildLessonPlan() the app
// itself calls.
function stepsByHeading(song, plan) {
  const STEP_WORDS = {
    listen: 'Listen', rhythm: 'Clap the rhythm', pitches: 'Play the notes, any speed',
    'phrase-slow': 'Play it slowly', 'tempo-ladder': 'Play it up to speed',
    chain: 'Play the phrases together', whole: 'Play the whole piece',
  };
  const byHeading = {};
  for (const step of plan.steps) {
    if (!step.passRule) continue; // 'listen' steps are driven by "Next", never by notes
    const key = (STEP_WORDS[step.kind] || step.kind) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')';
    const notes = step.notes.map((n) => ({ midi: n.midi, offsetSec: (n.start - step.originTick) / song.ticksPerQuarter * (60 / step.bpm) }));
    (byHeading[key] = byHeading[key] || []).push(notes);
  }
  return byHeading;
}
const HOT_CROSS_BUNS = starterSongs.find((s) => s.id === 'hot-cross-buns');
const HCB_PLAN = buildLessonPlan(HOT_CROSS_BUNS, HOT_CROSS_BUNS.parts[0].id, instrumentById.kbd);
const HCB_BY_HEADING = stepsByHeading(HOT_CROSS_BUNS, HCB_PLAN);

async function clickButtonNamed(page, text, scope = '.panel-songs-practice') {
  await page.evaluate(`Array.from(document.querySelectorAll('${scope} button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
}
async function currentHeadingOrPara(page) {
  return page.evaluate(
    "(() => { const h4 = document.querySelector('.panel-songs-practice h4'); if (h4) return h4.textContent; const p = document.querySelector('.panel-songs-practice p'); return p ? p.textContent : null; })()"
  );
}
async function clickMode(page, mode) {
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').getAttribute('aria-pressed') === 'true'`);
}
async function connectFakeMidi(page, id = 'p1', name = 'Test Keys') {
  await midiAddPort(page, id, name);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
}
async function selectKbdMod(page) {
  await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
  await page.waitFor("document.getElementById('picker').hidden === true");
}

// Real, timed note delivery for one judged step: waits for each note's own
// offset against the REAL audio clock (window.__coach.audioNow() /
// songsRecordStart() are reads of the running clock, not a driving hook --
// same use C7 in kbd-midi-check-path.test.mjs makes of them), then sends it
// either as a real fake-MIDI message or a real KeyboardEvent -- the two
// routes learning-events.js's isIndependentOk cares about (P1).
async function driveStepReal(page, notes, route) {
  const js = `(async () => {
    const notes = ${JSON.stringify(notes)};
    const inv = ${JSON.stringify(PCKEYS_INV)};
    for (const n of notes) {
      while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < n.offsetSec) { await new Promise(r => setTimeout(r, 4)); }
      ${route === 'midi'
        ? "window.__midiSend('p1', [0x90, n.midi, 100]);"
        : "document.dispatchEvent(new KeyboardEvent('keydown', { key: inv[n.midi] }));"}
    }
  })()`;
  await page.evaluate(js);
}

// Walks the whole open song to the end, every judged step driven with real,
// timed notes over `route` ('midi' or 'computer-key') -- never the debug
// hook's unsourced songsNoteAt seam, unlike the walk-past helpers in
// kbd-midi-check-path.test.mjs/kbd-practice-song-handoff.test.mjs, because a
// journey's STEPS may never go through window.__coach at all, not even the
// ones this test does not care about individually.
async function playSongToEnd(page, byHeading, route, { maxLoops = 40 } = {}) {
  const attemptCounts = {};
  for (let i = 0; i < maxLoops; i++) {
    const para = await page.evaluate("(document.querySelector('.panel-songs-practice p') || {}).textContent || null");
    if (para && para.includes('whole piece')) return Object.values(attemptCounts).reduce((a, b) => a + b, 0);
    const hasNext = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')");
    if (hasNext) { await clickButtonNamed(page, 'Next'); continue; }
    const heading = await page.evaluate("(() => { const h4 = document.querySelector('.panel-songs-practice h4'); return h4 && h4.textContent; })()");
    const headingKey = heading && (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const rungs = headingKey ? byHeading[headingKey] : null;
    if (!rungs) throw new Error('no known notes for step heading: ' + heading);
    const attemptIndex = Math.min(attemptCounts[headingKey] || 0, rungs.length - 1);
    attemptCounts[headingKey] = (attemptCounts[headingKey] || 0) + 1;
    const notes = rungs[attemptIndex];
    const ratePct = await page.evaluate(
      "(() => { const r = document.querySelector('.panel-songs-rate'); if (!r) return 100; const m = r.textContent.match(/(\\d+)%/); return m ? Number(m[1]) : 100; })()"
    );
    const scale = 100 / Math.max(1, Math.round(100 * (ratePct / 100)));
    const scaledNotes = notes.map((n) => ({ midi: n.midi, offsetSec: n.offsetSec * scale }));
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
    await driveStepReal(page, scaledNotes, route);
    await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')", 15000);
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  throw new Error('did not reach "whole piece" within the loop budget');
}

// The real "Your keyboard path" panel -- opened with a real click on the
// mod-options button, and closed with a real click on the Practice nav
// destination (src/app.js's navDestFor/routeTo: `dest === 'practice'` calls
// closePanel()), never window.__coach, so the step a journey reports is
// exactly what a learner would see on screen. Escape (src/ui/panels.js's
// container keydown listener) needs the page to already hold real keyboard
// focus, which a plain page.evaluate(...).click() does not reliably give
// it -- the real nav button is just as real an exit and does not depend on
// that.
async function openPathwayPanel(page) {
  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
}
async function readPathwayPanel(page) {
  await openPathwayPanel(page);
  const info = await page.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.pathway-steps li')).map(li => ({ step: li.getAttribute('data-step'), current: li.getAttribute('aria-current') }));
    const current = items.find(i => i.current === 'step');
    return {
      step: current ? current.step : null,
      hasAction: !!document.getElementById('pathwayAction'),
      actionText: document.getElementById('pathwayAction') ? document.getElementById('pathwayAction').textContent : null,
      wait: !!document.querySelector('.pathway-wait'),
      retained: !!document.querySelector('.pathway-retained'),
    };
  })()`);
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  await page.waitFor("document.getElementById('panelHost').hidden");
  return info;
}
async function clickPathwayAction(page) {
  await openPathwayPanel(page);
  await page.evaluate("document.getElementById('pathwayAction').click()");
}

// Real nav route to Progress (src/app.js navDestFor: 'history' panel <->
// 'progress' route), read back exactly as a learner would see it.
async function readRetention(page) {
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  const text = await page.evaluate("document.getElementById('historyRetention').textContent");
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === null");
  return text;
}
function countIn(text, label) {
  const m = text.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': (\\d+)'));
  return m ? Number(m[1]) : 0;
}

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

  // Ground truth for the Progress "Retained on a later check" bucket: the
  // SAME summarizeEvents() call #historyRetention itself makes
  // (src/ui/history.js), on the SAME real events -- never a hand-predicted
  // number, for the same reason Scenario 1's independent count is not one.
  const events = await page.evaluate('window.__coach.db().events');
  const expected = summarizeEvents(events, { skillMap: KBD_SONG_SKILL_MAP, skillMapInstrument: 'kbd' });
  assert.ok(expected.retained >= 1, 'the real two-day run must log at least one retained row');
  const retention = await readRetention(page);
  assert.equal(
    countIn(retention, 'Retained on a later check'), expected.retained,
    `Progress must count exactly what summarizeEvents agrees with (${expected.retained}): ` + retention
  );
  assert.deepEqual(page.exceptions, []);
});

// -----------------------------------------------------------------------
// Scenario 4: a learner reaches level 13 ("Hands together") the real way --
// twelve real #harderBtn clicks, never window.__coach.state().level= -- and
// plays each hand alone on real fake MIDI until Both unlocks, then switches
// to it with a real change event on the Hands selector. Reference for the
// unlock rule and the real-MIDI-per-element pattern:
// tests/characterization/kbd-hand-alone-gate.test.mjs (db()/cur().info are
// reads only, the one thing no real entry point can be asked for, same as
// that suite's own use of them).
// -----------------------------------------------------------------------
test('journey 4: hand-alone practice at level 13 unlocks Both, reached entirely through real clicks', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await selectKbdMod(page);
  await connectFakeMidi(page);

  for (let i = 1; i < 13; i++) await page.evaluate("document.getElementById('harderBtn').click()");
  await page.waitFor('window.__coach.state().level === 13');

  await page.waitFor("!!document.getElementById('optKbdHands')");
  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), true, 'Both must start locked at a fresh level 13');
  assert.equal(await page.evaluate("document.getElementById('optKbdHands').value"), 'right');

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Right hand alone, real MIDI, until j1r registers a graded attempt.
  for (let i = 0; i < 20; i++) {
    const reps = await page.evaluate("(window.__coach.db().mods.kbd.item.j1r || {}).reps || 0");
    if (reps > 0) break;
    const info = await page.evaluate('window.__coach.cur().info');
    await midiNoteOn(page, 'p1', info.ex.rh.midi);
    await page.waitFor("document.getElementById('feedback').className === 'ok'");
    await page.evaluate("document.getElementById('feedback').className = ''");
    await page.waitFor('window.__coach.task() && window.__coach.cur()');
  }
  assert.ok(await page.evaluate("(window.__coach.db().mods.kbd.item.j1r || {}).reps || 0") > 0, 'expected j1r to register a graded attempt within 20 elements');
  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), true, 'right alone is not enough on its own');

  // Real change event: switch to left alone. Each script block below runs in
  // the page's own top-level scope, so a bare `const` here would collide with
  // the next evaluate() below -- wrapped in a block statement to stay scoped.
  await page.evaluate(`{
    const sel = document.getElementById('optKbdHands');
    sel.value = 'left';
    sel.dispatchEvent(new Event('change'));
  }`);
  await page.waitFor('window.__coach.task() && window.__coach.cur()');

  for (let i = 0; i < 20; i++) {
    const reps = await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).reps || 0");
    if (reps > 0) break;
    const info = await page.evaluate('window.__coach.cur().info');
    await midiNoteOn(page, 'p1', info.ex.lh.midi);
    await page.waitFor("document.getElementById('feedback').className === 'ok'");
    await page.evaluate("document.getElementById('feedback').className = ''");
    await page.waitFor('window.__coach.task() && window.__coach.cur()');
  }
  assert.ok(await page.evaluate("(window.__coach.db().mods.kbd.item.j1l || {}).reps || 0") > 0, 'expected j1l to register a graded attempt within 20 elements');

  assert.equal(await page.evaluate("document.querySelector('#optKbdHands option[value=\"both\"]').disabled"), false, 'both hands alone must unlock Both');
  assert.equal(await page.evaluate("document.getElementById('kbdBothLock')"), null, 'the lock note must be gone once Both unlocks');

  // Real change event: switch to Both.
  await page.evaluate(`{
    const sel = document.getElementById('optKbdHands');
    sel.value = 'both';
    sel.dispatchEvent(new Event('change'));
  }`);
  await page.waitFor("document.getElementById('optKbdHands').value === 'both'");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  const bothId = await page.evaluate('window.__coach.cur().id');
  assert.match(bothId, /^j\d$/, 'a Both-hands element must carry the plain j<n> id, not a hand-alone j<n>r/j<n>l one');

  assert.deepEqual(page.exceptions, []);
});
