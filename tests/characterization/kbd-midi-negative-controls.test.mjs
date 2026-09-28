// E4a: live MIDI pipeline negative controls and a timing budget, for the
// keyboard song-practice path (src/ui/songs.js advance()). Drives real
// entry points throughout -- a fake Web MIDI port's note-on
// (tests/helpers/fake-midi.mjs), a real `keydown` KeyboardEvent, and real
// canvas focus/Enter -- never the debug hook for the input side under test.
// A note played with NO source (the debug hook's own songsNoteAt with no
// trailing argument) is used only to WALK PAST steps that are not the one
// under test; those rows log input 'unknown' in Check and never count
// (src/core/learning-events.js isIndependentOk), so they cannot
// contaminate the counted assertions below -- see the walk helper's own
// comment.
//
// See docs/assessment-kbd-midi.md for what this suite measured, the
// mutation table that shows it is red-first, and what it explicitly did
// not cover.
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
import { isIndependentOk, summarizeEvents } from '../../src/core/learning-events.js';
import { pathwayState } from '../../src/core/pathway.js';
import { en } from '../../src/core/i18n.js';

const htmlPath = HTML_PATH;
const TPQ = 480;

// Three challenge songs, same 'challenge/1' shape as songs-input-route's
// One Note Song. A: single note at tick 0 (pitch negatives, whole-piece
// end-to-end). B: two notes a beat apart (mixed-input route). C: a single
// note starting AFTER tick 0 (tick 960, one bar in) so "early" and "late"
// are both reachable relative to its own expected onset.
function songA() {
  return {
    schema: 'song/1', id: 'song-a', title: 'Song A', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
    chords: [],
  };
}
function songB() {
  return {
    schema: 'song/1', id: 'song-b', title: 'Song B', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 64 }, { start: 480, dur: 480, midi: 62 }] }],
    chords: [],
  };
}
function songC() {
  return {
    schema: 'song/1', id: 'song-c', title: 'Song C', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TPQ,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 960, dur: 480, midi: 64 }] }],
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

// The same plan the app itself builds for a fresh (level 1) practice
// session on this instrument -- see src/ui/songs.js startPractice's own
// `buildLessonPlan(song, partId, instrument, { level })` with no saved
// level. Tolerances and expected offsets below are read off THIS, never
// hard-coded.
const PLAN_A = buildLessonPlan(songA(), 'melody', instrumentById.kbd);
const PLAN_B = buildLessonPlan(songB(), 'melody', instrumentById.kbd);
const PLAN_C = buildLessonPlan(songC(), 'melody', instrumentById.kbd);

// A step's own notes, as `{ midi, offsetSec }` from the step's own origin --
// same formula tests/characterization/songs-lesson-modes.test.mjs's
// rhythmOffsets() uses for a timed step. An untimed step (bpm 0, "pitches")
// has no tempo to place a note AT; order is all that is judged, so each
// note here is just spaced a little apart in wall-clock terms.
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
}

async function clickButtonNamed(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

function headingStartsWith(prefix) {
  return `(document.querySelector('.panel-songs-practice h4') && document.querySelector('.panel-songs-practice h4').textContent.startsWith(${JSON.stringify(prefix)}))`;
}

// Reads the CURRENT on-screen heading, waiting for it to exist first (a
// transitional "feedback" paragraph can show alone for a moment right
// after "Stop and check").
async function currentHeading(page) {
  await page.waitFor("!!document.querySelector('.panel-songs-practice h4')");
  return page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
}

// Walks the CURRENT practice attempt forward, one plan step at a time,
// using unsourced hook notes (__coach.songsNoteAt, no trailing `source`)
// to pass every step BEFORE `targetKind`, and returns once that step's own
// heading is showing -- leaving "Your turn" unclicked so the caller can
// drive the target step's judged notes through a REAL entry point. A
// listen step (no passRule) is just clicked past with "Next".
//
// A clean first-try tempo-ladder pass makes nextStep() (src/song/lesson.js)
// skip the very next rung -- so the actual on-screen step can silently
// outrun this loop's own per-plan.steps.entry iteration (every rung shares
// the heading "Play it up to speed", and a double-skip can land straight
// on the target step). This reads the REAL heading before acting on each
// plan step and simply does nothing for one that has already been skipped
// past, rather than assuming lockstep correspondence with `plan.steps`.
async function walkToStep(page, plan, targetKind) {
  const targetHeading = STEP_HEADING[targetKind];
  const targetStep = plan.steps.find((s) => s.kind === targetKind);
  for (const step of plan.steps) {
    if (step.kind === targetKind) break;
    const heading = await currentHeading(page);
    if (heading.startsWith(targetHeading)) break;
    if (!heading.startsWith(STEP_HEADING[step.kind])) continue;
    if (!step.passRule) {
      await clickButtonNamed(page, 'Next');
      continue;
    }
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
    const offsets = offsetsForStep(step);
    await page.evaluate(
      `(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true)); })()`
    );
    await page.waitFor(`document.querySelector('.panel-songs-count').textContent.includes('${offsets.length}')`);
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  await page.waitFor(headingStartsWith(targetHeading));
  return targetStep;
}

// Same plain-word headings src/ui/songs.js's STEP_WORDS uses, quoted here
// only for the waitFor()/startsWith checks above -- never asserted as the
// finding under test.
const STEP_HEADING = {
  listen: 'Listen',
  rhythm: 'Clap the rhythm',
  pitches: 'Play the notes',
  'phrase-slow': 'Play it slowly',
  'tempo-ladder': 'Play it up to speed',
  whole: 'Play the whole piece',
};

// -----------------------------------------------------------------------
// T1: timing budget on a rhythm step (Song C -- the note starts a bar in,
// so "early" is reachable, not just "late").
// -----------------------------------------------------------------------
test('T1: a rhythm-step note early or late both miss the onset; on time counts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-midi-t1-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songC());
  const step = PLAN_C.steps.find((s) => s.kind === 'rhythm');
  const tolMs = step.passRule.maxMeanErrorMs;
  const tolSec = tolMs / 1000;
  const expected = offsetsForStep(step)[0].offsetSec;

  async function runCase(caseName, sendExpr, accept, describe) {
    return retryFlaky({
      attempts: 3,
      what: `Song C rhythm timing (${caseName})`,
      describe,
      accept,
      attempt: async () => {
        const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
        try {
          await importAndOpenSong(page, challengePath, 'Song C');
          await connectFakeMidi(page);
          await clickMode(page, 'check');
          await walkToStep(page, PLAN_C, 'rhythm');
          const before = await page.evaluate('window.__coach.db().events.length');
          await clickButtonNamed(page, 'Your turn');
          await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
          const measuredT = await page.evaluate(sendExpr);
          await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
          await clickButtonNamed(page, 'Stop and check');
          await page.waitFor('window.__coach.db().events.length > ' + before);
          const events = await page.evaluate('window.__coach.db().events');
          const row = events[events.length - 1];
          return { measuredT, row, exceptions: page.exceptions.slice() };
        } finally {
          await page.close();
        }
      },
    });
  }

  const early = await runCase(
    'early',
    "(() => { window.__midiSend('p1', [0x90, 64, 100]); return window.__coach.audioNow() - window.__coach.songsRecordStart(); })()",
    (r) => r.measuredT < expected - tolSec,
    (r) => `t=${r.measuredT}`
  );
  assert.equal(early.row.input, 'midi');
  assert.equal(early.row.dims.onset, 'miss');
  assert.deepEqual(early.exceptions, []);

  const late = await runCase(
    'late',
    `(async () => {
      while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < ${expected + 3 * tolSec}) { await new Promise(r => setTimeout(r, 4)); }
      window.__midiSend('p1', [0x90, 64, 100]);
      return window.__coach.audioNow() - window.__coach.songsRecordStart();
    })()`,
    (r) => r.measuredT > expected + tolSec,
    (r) => `t=${r.measuredT}`
  );
  assert.equal(late.row.input, 'midi');
  assert.equal(late.row.dims.onset, 'miss');
  assert.deepEqual(late.exceptions, []);

  const onTime = await runCase(
    'on-time',
    `(async () => {
      while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < ${expected}) { await new Promise(r => setTimeout(r, 4)); }
      window.__midiSend('p1', [0x90, 64, 100]);
      return window.__coach.audioNow() - window.__coach.songsRecordStart();
    })()`,
    (r) => r.measuredT - expected < tolSec,
    (r) => `t=${r.measuredT}`
  );
  assert.equal(onTime.row.input, 'midi');
  assert.equal(onTime.row.dims.onset, 'ok');
  assert.deepEqual(onTime.exceptions, []);
});

// -----------------------------------------------------------------------
// T2: pitch negatives on a pitches step (Song A -- untimed, single note).
// -----------------------------------------------------------------------
test('T2: a wrong note, a wrong octave and a velocity-0 note-on all miss the pitches step', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-midi-t2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songA());

  async function launchAtPitches() {
    const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
    await importAndOpenSong(page, challengePath, 'Song A');
    await connectFakeMidi(page);
    await clickMode(page, 'check');
    await walkToStep(page, PLAN_A, 'pitches');
    return page;
  }

  // wrong note: MIDI 62 instead of the expected 64.
  {
    const page = await launchAtPitches();
    try {
      const before = await page.evaluate('window.__coach.db().events.length');
      await clickButtonNamed(page, 'Your turn');
      await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
      await page.evaluate("window.__midiSend('p1', [0x90, 62, 100]);");
      await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
      await clickButtonNamed(page, 'Stop and check');
      await page.waitFor('window.__coach.db().events.length > ' + before);
      const events = await page.evaluate('window.__coach.db().events');
      const row = events[events.length - 1];
      assert.equal(row.dims.pitch, 'miss');
      assert.equal(isIndependentOk(row), false);
      assert.ok(!(await page.evaluate("!!document.querySelector('.panel-songs-check-result')")), 'a failed try shows no check-result line');
      assert.notEqual(
        pathwayState({ events: [{ ...row, skill: 'whole:null' }], sessions: [], midiProof: true, level: 2, now: row.at }).step,
        'return'
      );
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }

  // wrong octave: MIDI 76 (same pitch class as 64, wrong octave) -- kbd's
  // octavePolicy is 'exact' (src/instruments/kbd.js), so this still misses.
  {
    const page = await launchAtPitches();
    try {
      const before = await page.evaluate('window.__coach.db().events.length');
      await clickButtonNamed(page, 'Your turn');
      await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
      await page.evaluate("window.__midiSend('p1', [0x90, 76, 100]);");
      await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
      await clickButtonNamed(page, 'Stop and check');
      await page.waitFor('window.__coach.db().events.length > ' + before);
      const events = await page.evaluate('window.__coach.db().events');
      const row = events[events.length - 1];
      assert.equal(row.dims.pitch, 'miss');
      assert.equal(isIndependentOk(row), false);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }

  // velocity-0 note-on: src/core/midi.js's createMidiParser reads this as a
  // note-OFF, so nothing is heard at all -- the count never reaches 1.
  {
    const page = await launchAtPitches();
    try {
      const before = await page.evaluate('window.__coach.db().events.length');
      await clickButtonNamed(page, 'Your turn');
      await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
      await page.evaluate("window.__midiSend('p1', [0x90, 64, 0]);");
      await page.evaluate(`(async () => {
        const start = window.__coach.audioNow();
        while (window.__coach.audioNow() - start < 0.5) { await new Promise(r => setTimeout(r, 20)); }
      })()`);
      const stillZero = await page.evaluate("document.querySelector('.panel-songs-count').textContent.includes('Notes heard so far: 0')");
      assert.ok(stillZero, 'a velocity-0 note-on must never be counted as a heard note');
      await clickButtonNamed(page, 'Stop and check');
      await page.waitFor('window.__coach.db().events.length > ' + before);
      const events = await page.evaluate('window.__coach.db().events');
      const row = events[events.length - 1];
      // The app still logs a row for this judged step (finishRecording runs
      // regardless of how many notes were actually heard) -- with nothing
      // played, the one expected note reads as a plain miss, the same
      // outcome a wrong note gives, not a missing row and not a crash.
      assert.equal(row.dims.pitch, 'miss');
      assert.equal(isIndependentOk(row), false);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }

  // Positive control: the same relabel-to-whole-piece counterfactual on a
  // clean MIDI pass DOES read 'return' -- proving the negative cases above
  // are failing for the reason claimed, not because pathwayState always
  // says no.
  {
    const page = await launchAtPitches();
    try {
      const before = await page.evaluate('window.__coach.db().events.length');
      await clickButtonNamed(page, 'Your turn');
      await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
      await page.evaluate("window.__midiSend('p1', [0x90, 64, 100]);");
      await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
      await clickButtonNamed(page, 'Stop and check');
      await page.waitFor('window.__coach.db().events.length > ' + before);
      const events = await page.evaluate('window.__coach.db().events');
      const row = events[events.length - 1];
      assert.equal(row.input, 'midi');
      assert.equal(isIndependentOk(row), true);
      assert.equal(
        pathwayState({ events: [{ ...row, skill: 'whole:null' }], sessions: [], midiProof: true, level: 2, now: row.at }).step,
        'return'
      );
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }

  // Duplicate note-on, TOLERATED at base: the pitches step matches its one
  // expected note against the FIRST played event that fits it and never
  // looks for a second one (src/ui/songs/practice.js's single-note match
  // path never populates `extras` at all) -- so a duplicate press is
  // silently absorbed, not flagged. This is not a negative control at
  // base; recorded here as a finding (docs/assessment-kbd-midi.md), not
  // asserted as a bug.
  {
    const page = await launchAtPitches();
    try {
      const before = await page.evaluate('window.__coach.db().events.length');
      await clickButtonNamed(page, 'Your turn');
      await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
      await page.evaluate("window.__midiSend('p1', [0x90, 64, 100]); window.__midiSend('p1', [0x90, 64, 100]); window.__midiSend('p1', [0x80, 64, 0]);");
      await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('2')");
      await clickButtonNamed(page, 'Stop and check');
      await page.waitFor('window.__coach.db().events.length > ' + before);
      const events = await page.evaluate('window.__coach.db().events');
      const row = events[events.length - 1];
      assert.equal(row.input, 'midi');
      const resultText = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
      assert.equal(resultText, en['songs.mode.counted']);
      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
    }
  }
});

// -----------------------------------------------------------------------
// T4: mixed input on a pitches step (Song B -- two notes, one beat apart).
// -----------------------------------------------------------------------
test('T4: a step judged from more than one input route logs "mixed" or "unknown", never counted', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-midi-t4-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songB());

  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await importAndOpenSong(page, challengePath, 'Song B');
  await connectFakeMidi(page);
  await clickMode(page, 'check');
  await walkToStep(page, PLAN_B, 'pitches');

  // (a) real MIDI 64, then a real computer-key press for 62 ('s').
  {
    const before = await page.evaluate('window.__coach.db().events.length');
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
    await page.evaluate("window.__midiSend('p1', [0x90, 64, 100]);");
    await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
    await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));");
    await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('2')");
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor('window.__coach.db().events.length > ' + before);
    const events = await page.evaluate('window.__coach.db().events');
    const row = events[events.length - 1];
    assert.equal(row.input, 'mixed');
    const resultText = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
    assert.equal(resultText, en['songs.mode.practiceOnly']);
    assert.equal(isIndependentOk(row), false);
    assert.deepEqual(page.exceptions, []);
  }

  // (b) restart the step (Check always starts at step 1; switching to
  // Learn then back to Check re-runs startPractice() fresh) -- real MIDI
  // 64, then 62 with NO source, driven through the canvas focus cursor if
  // it names 62, else through the debug hook's own no-source seam.
  await clickMode(page, 'learn');
  await clickMode(page, 'check');
  await walkToStep(page, PLAN_B, 'pitches');
  {
    const before = await page.evaluate('window.__coach.db().events.length');
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
    await page.evaluate("window.__midiSend('p1', [0x90, 64, 100]);");
    await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");

    await page.evaluate("document.getElementById('cv').focus()");
    let pathUsed = 'canvas';
    let named = null;
    for (let i = 0; i < 25; i++) {
      named = await page.evaluate("(() => { const fi = window.__coach.kbdFocus(); return fi ? fi.m : null; })()");
      if (named === 62) break;
      await page.press('ArrowRight');
    }
    if (named === 62) {
      await page.press('Enter');
    } else {
      // Fallback: no focusable key named 62 was found on screen (e.g. a
      // narrow drawn range) -- still an unsourced note, same convention.
      pathUsed = 'hook-fallback';
      await page.evaluate('window.__coach.songsNote(62, true)');
    }
    await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('2')");
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor('window.__coach.db().events.length > ' + before);
    const events = await page.evaluate('window.__coach.db().events');
    const row = events[events.length - 1];
    assert.equal(row.input, 'unknown', `path used: ${pathUsed}`);
    const resultText = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
    assert.equal(resultText, en['songs.mode.practiceOnly']);
    assert.deepEqual(page.exceptions, []);
  }
});

// -----------------------------------------------------------------------
// T5: whole-step end to end, Progress and the pathway (Song A).
// -----------------------------------------------------------------------
test('T5: a computer-key whole-piece pass never counts; a MIDI one does, and Progress/pathway agree', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kbd-midi-t5-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = writeChallenge(dir, songA());
  const wholeStep = PLAN_A.steps.find((s) => s.kind === 'whole');
  const tolSec = wholeStep.passRule.maxMeanErrorMs / 1000;
  const expected = offsetsForStep(wholeStep)[0].offsetSec;

  await retryFlaky({
    attempts: 3,
    what: 'T5 whole-piece end to end',
    describe: (r) => (r.ok ? 'ok' : r.reason),
    accept: (r) => r.ok,
    attempt: async () => {
      const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
      try {
        await importAndOpenSong(page, challengePath, 'Song A');
        await connectFakeMidi(page);
        await clickMode(page, 'check');
        await walkToStep(page, PLAN_A, 'whole');

        const before1 = await page.evaluate('window.__coach.db().events.length');
        await clickButtonNamed(page, 'Your turn');
        await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
        const t1 = await page.evaluate(`(async () => {
          while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < ${expected}) { await new Promise(r => setTimeout(r, 4)); }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
          return window.__coach.audioNow() - window.__coach.songsRecordStart();
        })()`);
        if (Math.abs(t1 - expected) >= tolSec) return { ok: false, reason: `computer-key try landed t=${t1}, expected ${expected}` };
        await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
        await clickButtonNamed(page, 'Stop and check');
        await page.waitFor('window.__coach.db().events.length > ' + before1);

        const events1 = await page.evaluate('window.__coach.db().events');
        const row1 = events1[events1.length - 1];
        if (row1.skill !== 'whole:null' || row1.input !== 'computer-key' || row1.assistance !== 'none') {
          return { ok: false, reason: `unexpected row1 ${JSON.stringify(row1)}` };
        }
        const state1 = pathwayState({ events: events1, sessions: [], midiProof: true, level: 2, now: row1.at });
        if (state1.step !== 'check') return { ok: false, reason: `pathway step ${state1.step}, expected check` };
        if (summarizeEvents(events1).independent !== 0) return { ok: false, reason: 'Progress already counts an unproven pass' };
        const resultText1 = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
        if (resultText1 !== en['songs.mode.practiceOnly']) return { ok: false, reason: `verdict ${resultText1}` };

        // "Practise again" keeps the mode (src/ui/songs.js restart()) --
        // walk to 'whole' again and this time pass it on a real MIDI note.
        await clickButtonNamed(page, 'Practise again');
        await page.waitFor("document.querySelector('.panel-songs-practice h4')");
        await walkToStep(page, PLAN_A, 'whole');

        const before2 = await page.evaluate('window.__coach.db().events.length');
        await clickButtonNamed(page, 'Your turn');
        await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
        const t2 = await page.evaluate(`(async () => {
          while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < ${expected}) { await new Promise(r => setTimeout(r, 4)); }
          window.__midiSend('p1', [0x90, 64, 100]);
          return window.__coach.audioNow() - window.__coach.songsRecordStart();
        })()`);
        if (Math.abs(t2 - expected) >= tolSec) return { ok: false, reason: `MIDI try landed t=${t2}, expected ${expected}` };
        await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
        await clickButtonNamed(page, 'Stop and check');
        await page.waitFor('window.__coach.db().events.length > ' + before2);

        const events2 = await page.evaluate('window.__coach.db().events');
        const row2 = events2[events2.length - 1];
        const resultText2 = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
        if (resultText2 !== en['songs.mode.counted'] || row2.input !== 'midi') {
          return { ok: false, reason: `unexpected row2/verdict ${JSON.stringify(row2)} / ${resultText2}` };
        }
        const state2 = pathwayState({ events: events2, sessions: [], midiProof: true, level: 2, now: row2.at });
        if (state2.step !== 'return') return { ok: false, reason: `pathway step ${state2.step}, expected return` };

        await page.evaluate("window.__coach.openPanel('history')");
        await page.waitFor("!!document.getElementById('historyRetention')");
        const historyText = await page.evaluate("document.getElementById('historyRetention').textContent");
        if (!historyText.includes('Passed on your own: 1')) return { ok: false, reason: `history text: ${historyText}` };

        if (page.exceptions.length) return { ok: false, reason: `exceptions: ${JSON.stringify(page.exceptions)}` };
        return { ok: true };
      } finally {
        await page.close();
      }
    },
  });
});
