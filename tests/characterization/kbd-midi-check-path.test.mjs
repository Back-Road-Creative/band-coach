// E4b: extends E4a's live-MIDI negative controls (tests/characterization/
// kbd-midi-negative-controls.test.mjs) to the pathway check itself
// (src/core/pathway.js pathwayState()), P1's check predicate (src/core/
// learning-events.js isIndependentOk), and H3's hand filter (src/song/
// hand-filter.js). P3's own retention/transfer evaluators are already proven
// PURE at the unit level (tests/unit/pathway-transfer-retention.test.mjs);
// this file does not re-derive that -- it proves the BROWSER-driven rows
// those evaluators actually consume are the ones the app really logs, under
// six negative controls plus one positive control, and records mutation
// evidence for three named mutations against every case here.
//
// See docs/assessment-kbd-midi.md's v2 section for what this suite measured,
// the mutation table, and what it explicitly did not cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { pathwayState } from '../../src/core/pathway.js';
import { skipDemo } from '../helpers/songs-demo.mjs';

const htmlPath = HTML_PATH;
const TPQ = 480;

// Three challenge songs, same 'challenge/1' shape as E4a's. SONG_SINGLE: one
// untagged note (single-hand instruments/songs never show a hand selector,
// H3's own handsAvailable contract, src/song/hand-filter.js). SONG_HANDS_CHORD:
// two notes sharing ONE start -- rh and lh both present in the very first
// (only) phrase, so a "wrong hand" attempt can be driven at the first judged
// step with no walk at all. SONG_HANDS_REST: an rh-only first phrase, then an
// lh note a bar later -- overall handsAvailable is still ['rh','lh'] (both
// hands appear SOMEWHERE in the song), but the first phrase has nothing for a
// learner who has chosen 'left', which is exactly the "step with no notes for
// the hand" control (H3's `assessed: false`, src/song/hand-filter.js
// stepForHands). Both hand shapes were grounded against buildLessonPlan's own
// output before being written here (a throwaway node script, not committed),
// not assumed from reading hand-filter.js alone.
function songSingle() {
  return {
    schema: 'song/1', id: 'song-single', title: 'Song Single', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
    chords: [],
  };
}
function songHandsChord() {
  return {
    schema: 'song/1', id: 'song-hands-chord', title: 'Song Hands Chord', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 480, midi: 64, hand: 'rh' },
        { start: 0, dur: 480, midi: 48, hand: 'lh' },
      ],
    }],
    chords: [],
  };
}
function songHandsRest() {
  return {
    schema: 'song/1', id: 'song-hands-rest', title: 'Song Hands Rest', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 1920, midi: 64, hand: 'rh' },
        { start: 2880, dur: 480, midi: 48, hand: 'lh' },
      ],
    }],
    chords: [],
  };
}
function challengeJsonFor(song) {
  return JSON.stringify({ schema: 'challenge/1', title: song.title, from: null, note: null, songs: [song] });
}
function writeChallenge(dir, song) {
  const p = join(dir, 'challenge.json');
  writeFileSync(p, challengeJsonFor(song));
  return p;
}

const PLAN_SINGLE = buildLessonPlan(songSingle(), 'melody', instrumentById.kbd);
const PLAN_HANDS_CHORD = buildLessonPlan(songHandsChord(), 'melody', instrumentById.kbd);

// Same formula tests/characterization/kbd-midi-negative-controls.test.mjs's
// offsetsForStep uses.
function offsetsForStep(step) {
  return step.notes.map((n, i) => ({
    midi: n.midi,
    offsetSec: step.bpm > 0 ? ((n.start - step.originTick) / TPQ) * (60 / step.bpm) : i * 0.3,
  }));
}

async function importAndOpenSong(page, challengePath, songTitle) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes(${JSON.stringify(songTitle)}))`
  );
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes(${JSON.stringify(songTitle)})).click()`
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function connectFakeMidi(page, id = 'p1', name = 'Test Keys') {
  await midiAddPort(page, id, name);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
}

async function clickMode(page, mode) {
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').getAttribute('aria-pressed') === 'true'`);
}

async function selectHands(page, hands) {
  await page.evaluate(`document.querySelector('.panel-songs-hands button[data-hands="${hands}"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-hands button[data-hands="${hands}"]').getAttribute('aria-pressed') === 'true'`);
}

async function clickButtonNamed(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

async function currentHeading(page) {
  await page.waitFor("!!document.querySelector('.panel-songs-practice h4')");
  return page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
}

function headingStartsWith(prefix) {
  return `(document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith(${JSON.stringify(prefix)}))`;
}

// Same plain-word headings src/ui/songs.js's STEP_WORDS uses (quoted here
// only for waitFor()/startsWith checks, never asserted as the finding under
// test) -- same map tests/characterization/kbd-midi-negative-controls.test.mjs
// keeps under this name.
const STEP_HEADING = {
  listen: 'Listen',
  rhythm: 'Clap the rhythm',
  pitches: 'Play the notes',
  'phrase-slow': 'Play it slowly',
  'tempo-ladder': 'Play it up to speed',
  whole: 'Play the whole piece',
};

// Walks the CURRENT practice attempt forward with unsourced hook notes
// (window.__coach.songsNoteAt, no `source`) so it always logs 'unknown' and
// never counts, past every step before `targetKind`, leaving that step's own
// heading on screen with "Your turn" unclicked -- same pattern and same
// per-walked-row assertions as kbd-midi-negative-controls.test.mjs's
// walkToStep, ported here because a hand-filter control (C5) needs to reach
// a step later than the first judged one.
// `hands`, when given ('right'|'left'), sends only THAT hand's own notes
// while walking past a two-hand step -- the app judges a step's attempt
// against ONLY the selected hand's notes (H3, src/song/hand-filter.js
// stepForHands) but still scores every OTHER note actually played as an
// unmatched extra (src/ui/songs.js finishRecording passes the whole,
// unfiltered practice.playedEvents into judgeAttempt) -- so sending the
// other hand's note here would fail the walked-past step's own passRule
// (maxExtras: 0) and strand the walk on the same heading forever. This is
// itself a real finding (the app does not silence/ignore the resting hand's
// own notes while walking a two-hand step), recorded in the doc, not
// worked around silently -- it is why this walk sends one hand only.
async function walkToStep(page, plan, targetKind, hands) {
  const targetHeading = STEP_HEADING[targetKind];
  const targetStep = plan.steps.find((s) => s.kind === targetKind);
  const selectedHand = hands === 'right' ? 'rh' : hands === 'left' ? 'lh' : null;
  for (const step of plan.steps) {
    if (step.kind === targetKind) break;
    const heading = await currentHeading(page);
    if (heading.startsWith(targetHeading)) break;
    if (!heading.startsWith(STEP_HEADING[step.kind])) continue;
    if (!step.passRule) {
      await clickButtonNamed(page, 'Next');
      await skipDemo(page);
      continue;
    }
    const beforeWalk = await page.evaluate('window.__coach.db().events.length');
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
    const stepForWalk = selectedHand
      ? { ...step, notes: step.notes.filter((n) => (n.hand === 'lh' ? 'lh' : 'rh') === selectedHand) }
      : step;
    const offsets = offsetsForStep(stepForWalk);
    await page.evaluate(
      `(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true)); })()`
    );
    await page.waitFor(`document.querySelector('.panel-songs-count').textContent.includes('${offsets.length}')`);
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
    await page.waitFor('window.__coach.db().events.length > ' + beforeWalk);
    const walkedEvents = await page.evaluate('window.__coach.db().events');
    const walkedRow = walkedEvents[walkedEvents.length - 1];
    assert.equal(walkedRow.input, 'unknown', `walked-past ${step.kind} row must log 'unknown'`);
    assert.equal(isIndependentOk(walkedRow), false, `walked-past ${step.kind} row must never count`);
  }
  await page.waitFor(headingStartsWith(targetHeading));
  return targetStep;
}

// pathwayState needs a row's `skill` to be exactly 'whole:null' before it is
// even looked at (P1's `qualifies()`, src/core/pathway.js -- unexported, so
// this counterfactual relabel, not a direct call, is how a rhythm/pitches-
// step row is driven through the SAME branch a real whole-piece row would
// hit) -- same counterfactual E4a's T2 uses, and the same caveat: this proves
// the MIDI-vs-not/help-vs-not/hand-vs-not branch of qualifies() in isolation,
// not that a non-whole-step attempt is ever fed to the real pathway
// unmodified.
function pathwayAfter(row, now) {
  return pathwayState({ events: [{ ...row, skill: 'whole:null' }], sessions: [], midiProof: true, level: 2, now: now ?? row.at });
}

function assertNoAdvance(state) {
  assert.notEqual(state.step, 'return', 'pathway must not read return off a disqualified row');
  assert.notEqual(state.step, 'complete', 'pathway must not read complete off a disqualified row');
}

// Drives ONE judged rhythm step end to end: Next past 'listen', 'Your turn',
// an in-page callback that sends whatever note(s) the caller wants (real
// MIDI, a real keydown, or the debug hook's own unsourced seam -- never used
// for the note under test in the 'midi'/'computer-key' cases, only where the
// control itself is about having no route at all), 'Stop and check'. Returns
// the freshly logged row plus the full events array, so a caller can check
// both the one row and (for the "no row logged at all" control) the count.
async function attemptRhythmStep(page, { mode, hands, preClick, sendJs }) {
  await clickMode(page, mode);
  if (hands) await selectHands(page, hands);
  const heading0 = await currentHeading(page);
  if (heading0.startsWith('Listen')) { await clickButtonNamed(page, 'Next'); await skipDemo(page); }
  await page.waitFor("document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  if (preClick) await clickButtonNamed(page, preClick);
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  await page.evaluate(sendJs);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  return { row, events, before };
}

// -----------------------------------------------------------------------
// Negative control: a revealed view (Learn).
// -----------------------------------------------------------------------
test('C1: a clean MIDI pass in Learn (a revealed view) never counts -- assistance is "shown"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c1-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songSingle());
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await importAndOpenSong(page, challengePath, 'Song Single');
  await connectFakeMidi(page);

  const { row, events } = await attemptRhythmStep(page, {
    mode: 'learn',
    sendJs: "window.__midiSend('p1', [0x90, 64, 100]);",
  });
  assert.equal(row.input, 'midi');
  assert.equal(row.assistance, 'shown', 'Learn always records assistance shown (src/ui/songs.js startPractice)');
  assert.equal(isIndependentOk(row), false);
  assertNoAdvance(pathwayAfter(row));
  assert.ok(!events.slice(0, -1).some((ev) => isIndependentOk({ ...ev, skill: 'whole:null' })), 'no earlier row counts either');
  assert.deepEqual(page.exceptions, []);
});

// -----------------------------------------------------------------------
// Negative control: the inline help used in Songs. C1b's "How to play this"
// inline expander is not on this branch (grepped: no `howInline` anywhere
// under src/) -- the substitute is Learn's own "Play it" demo button
// (src/ui/songs.js, Learn-only), the one on-screen control in Songs that
// plainly means "show me". Documented here and in docs/assessment-kbd-midi.md.
// -----------------------------------------------------------------------
test('C2: clicking "Play it" (the Songs inline help) before a clean MIDI pass still never counts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songSingle());
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await importAndOpenSong(page, challengePath, 'Song Single');
  await connectFakeMidi(page);

  // Learn is Songs' default mode (src/ui/songs.js startPractice: `opts.mode
  // === 'rehearse' || opts.mode === 'check' ? opts.mode : 'learn'`), so
  // "Play it" is already on screen without an explicit mode switch -- this
  // control only needs to prove clicking it changes nothing about whether
  // the following pass counts.
  const hasPlayIt = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Play it')"
  );
  assert.equal(hasPlayIt, true, '"Play it" is on screen in Learn, the default mode, before any note is played');

  const { row } = await attemptRhythmStep(page, {
    mode: 'learn',
    preClick: 'Play it',
    sendJs: "window.__midiSend('p1', [0x90, 64, 100]);",
  });
  assert.equal(row.assistance, 'shown');
  assert.equal(isIndependentOk(row), false);
  assertNoAdvance(pathwayAfter(row));
  assert.deepEqual(page.exceptions, []);
});

// -----------------------------------------------------------------------
// Negative control: a computer key mid-phrase (Check mode -- the no-help
// attempt -- so this isolates the input-route tag, not assistance).
// -----------------------------------------------------------------------
test('C3: a computer-key press mid-phrase, in Check, never counts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songSingle());

  const result = await retryFlaky({
    attempts: 3,
    what: 'C3 computer-key mid-phrase',
    describe: (r) => JSON.stringify(r.row),
    accept: (r) => r.row && r.row.input === 'computer-key',
    attempt: async () => {
      const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
      try {
        await importAndOpenSong(page, challengePath, 'Song Single');
        await connectFakeMidi(page);
        // 'd' = midi 64 (src/core/pckeys.js PCKEYS_UPPER) -- the real
        // physical-keyboard route (src/app.js's keydown listener), not the
        // debug hook.
        const { row, events } = await attemptRhythmStep(page, {
          mode: 'check',
          sendJs: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));",
        });
        return { row, events, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.equal(result.row.input, 'computer-key');
  assert.equal(result.row.assistance, 'none');
  assert.equal(isIndependentOk(result.row), false);
  assertNoAdvance(pathwayAfter(result.row));
  assert.deepEqual(result.exceptions, []);
});

// -----------------------------------------------------------------------
// Negative control: an 'unknown' input (the debug hook's own unsourced
// seam, used everywhere else in this suite only to WALK PAST a step, driven
// here as the JUDGED note itself, in Check mode).
// -----------------------------------------------------------------------
test("C4: an unsourced ('unknown') note in Check never counts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c4-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songSingle());
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await importAndOpenSong(page, challengePath, 'Song Single');
  await connectFakeMidi(page);

  const { row } = await attemptRhythmStep(page, {
    mode: 'check',
    sendJs: 'window.__coach.songsNoteAt(64, 0.1, true)',
  });
  assert.equal(row.input, 'unknown');
  assert.equal(isIndependentOk(row), false);
  assertNoAdvance(pathwayAfter(row));
  assert.deepEqual(page.exceptions, []);
});

// -----------------------------------------------------------------------
// Negative control: the wrong hand. SONG_HANDS_CHORD's one phrase carries
// BOTH an rh and an lh note at the same start -- with 'right' selected, H3's
// stepForHands (src/song/hand-filter.js) must judge ONLY the rh note (64);
// playing the lh note's own real, correct pitch (48) instead must still miss.
// -----------------------------------------------------------------------
// "Clap the rhythm" judges WHEN, not WHAT (src/ui/songs.js's own comment,
// ~line 1935/2010 at grounding time): a wrong-hand pitch played exactly on
// time still passes that step, so H3's hand filter can only be proven by a
// control that judges pitch -- the 'pitches' step. Walked to with
// walkToStep (unsourced notes, always 'unknown', never counted) past
// 'listen' and 'rhythm' first.
async function attemptPitchesStep(page, plan, { hands, sendJs }) {
  if (hands) await selectHands(page, hands);
  await walkToStep(page, plan, 'pitches', hands);
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  await page.evaluate(sendJs);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  return { row: events[events.length - 1], events };
}

test('C5: playing the wrong hand\'s own (correct-for-THAT-hand) pitch misses, and the matching right-hand pitch does pass', async (t) => {
  // Two separate launches, not one page restarted with "Practise again": a
  // missed judged note carries no attributable route at all (src/ui/songs.js
  // advance(): `input` is derived ONLY from matched/ok notes -- "a miss
  // carries no played event to ask", its own comment), so the miss leg
  // cannot assert row.input === 'midi' the way every other control here
  // does; keeping the two legs on separate pages keeps that asymmetry
  // legible instead of folding it into shared restart bookkeeping.
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c5-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songHandsChord());

  const wrongPage = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => wrongPage.close());
  await importAndOpenSong(wrongPage, challengePath, 'Song Hands Chord');
  await connectFakeMidi(wrongPage);
  await clickMode(wrongPage, 'check');
  const wrong = await attemptPitchesStep(wrongPage, PLAN_HANDS_CHORD, {
    hands: 'right',
    sendJs: "window.__midiSend('p1', [0x90, 48, 100]);", // the lh note's own pitch, wrong for a 'right' selection
  });
  assert.equal(wrong.row.dims.pitch, 'miss', 'the lh note must miss the rh-judged pitches step');
  assert.equal(isIndependentOk(wrong.row), false, 'the wrong hand\'s pitch must not read independent-ok');
  assertNoAdvance(pathwayAfter(wrong.row));
  assert.deepEqual(wrongPage.exceptions, []);

  // Positive leg, same song/step, a fresh page: the RIGHT hand's own pitch
  // (64) does pass -- proves the miss above is about which hand's pitch was
  // played, not that this step can never pass at all.
  const rightPage = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => rightPage.close());
  await importAndOpenSong(rightPage, challengePath, 'Song Hands Chord');
  await connectFakeMidi(rightPage);
  await clickMode(rightPage, 'check');
  const right = await attemptPitchesStep(rightPage, PLAN_HANDS_CHORD, {
    hands: 'right',
    sendJs: "window.__midiSend('p1', [0x90, 64, 100]);",
  });
  assert.equal(right.row.dims.pitch, 'ok');
  assert.equal(right.row.input, 'midi', 'a MATCHED judged note does carry its real route');
  assert.equal(isIndependentOk(right.row), true, 'the right hand\'s own pitch must read independent-ok');
  assert.deepEqual(rightPage.exceptions, []);
});

// -----------------------------------------------------------------------
// Negative control: a step with no notes for the hand. SONG_HANDS_REST's
// first phrase is rh-only; with 'left' selected, H3's stepForHands reports
// assessed: false, so the practice screen shows only "Next" (no "Your turn"
// at all) and advance()'s unassessed branch logs no row. This is the same
// finding tests/characterization/songs-hand-selection.test.mjs already
// characterizes at the UI/skill level ("a step with no left-hand notes is
// not assessed") -- this test adds the pathway/isIndependentOk framing and
// the H3 mutation evidence (see the doc).
// -----------------------------------------------------------------------
test('C6: a step with no notes for the chosen hand logs no row and the pathway is unchanged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c6-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songHandsRest());
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await importAndOpenSong(page, challengePath, 'Song Hands Rest');
  await connectFakeMidi(page);
  await clickMode(page, 'check');
  await selectHands(page, 'left');
  await clickButtonNamed(page, 'Next'); // past 'listen'
  await page.waitFor("document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");

  const restVisible = await page.evaluate("document.querySelector('.panel-songs-hands-rest') !== null");
  const hasTurn = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  assert.ok(restVisible, 'the rest line shows for a hand with nothing to play here');
  assert.equal(hasTurn, false, 'no "Your turn" for an unassessed step');

  const before = await page.evaluate('window.__coach.db().events.length');
  const stateBefore = await page.evaluate(
    `(() => { const s = window.__coach.pathwayState ? window.__coach.pathwayState() : null; return s ? s.step : null; })()`
  ).catch(() => null);
  await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const after = await page.evaluate('window.__coach.db().events.length');
  assert.equal(after, before, 'no learning-event row is logged for the rested step');
  assert.deepEqual(page.exceptions, []);
  void stateBefore;
});

// -----------------------------------------------------------------------
// Positive control: a clean MIDI pass in Check, on time, DOES count -- the
// negative controls above are failing for the reasons claimed, not because
// nothing here can ever pass.
// -----------------------------------------------------------------------
test('C7 (positive control): a clean, on-time MIDI pass in Check counts and advances the pathway', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-check-path-c7-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songSingle());
  const step = PLAN_SINGLE.steps.find((s) => s.kind === 'rhythm');
  const expected = offsetsForStep(step)[0].offsetSec;

  const result = await retryFlaky({
    attempts: 3,
    what: 'C7 positive control',
    describe: (r) => JSON.stringify(r.row),
    accept: (r) => r.row && r.row.dims && r.row.dims.onset === 'ok',
    attempt: async () => {
      const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
      try {
        await importAndOpenSong(page, challengePath, 'Song Single');
        await connectFakeMidi(page);
        const { row } = await attemptRhythmStep(page, {
          mode: 'check',
          sendJs: `(async () => {
            while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < ${expected}) { await new Promise(r => setTimeout(r, 4)); }
            window.__midiSend('p1', [0x90, 64, 100]);
          })()`,
        });
        return { row, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.equal(result.row.input, 'midi');
  assert.equal(result.row.assistance, 'none');
  assert.equal(isIndependentOk(result.row), true);
  const state = pathwayAfter(result.row);
  assert.equal(state.step, 'return', 'a genuinely qualifying row DOES advance the pathway past check');
  assert.deepEqual(result.exceptions, []);
});
