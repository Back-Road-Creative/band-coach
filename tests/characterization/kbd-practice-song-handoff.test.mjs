// The keyboard trainer's "Play a song with these notes" hand-off to the
// Songs panel, and its "Back to practice" return -- src/instruments/
// kbd-songs.js decides WHICH song and WHEN, src/app.js's renderOpts renders
// the button, src/ui/songs.js opens the starter song's lesson and, only for
// a hand-off that named a returnTo, offers the way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;

// Every real check step (rhythm/pitches/phrase-slow/tempo-ladder/chain/whole)
// needs its WHOLE phrase played correctly, not one note (judgeAttempt's
// maxExtras:0/hitRate rejects a partial attempt) -- so this drives the exact
// same buildLessonPlan() the app itself calls (src/song/lesson.js), keyed by
// the full on-screen heading text (stepTitle()+' (bars X-Y)',
// src/ui/songs.js:1356), each step's OWN bpm (phrase-slow bakes in a fixed
// 0.55 tempoScale, a tempo-ladder rung its own LADDER_FRACTIONS value --
// src/song/lesson.js:468-515 -- so the SAME bars/notes are played at
// DIFFERENT bpms by different step kinds; a bars-only key once collapsed
// phrase-slow's 55bpm into rhythm's 100bpm and judged every phrase-slow
// attempt "late" -- see this file's own history). tempo-ladder repeats the
// same heading for all 4 rungs, in LADDER_FRACTIONS order, so those keep
// their OWN array (one entry per rung) and a per-key attempt counter below
// walks it in order -- valid because a correctly-timed attempt (this
// helper's whole point) always passes first try and advances to the next
// rung, never repeats one.
const HOT_CROSS_BUNS_STEPS_BY_HEADING = (() => {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const plan = buildLessonPlan(song, song.parts[0].id, instrumentById.kbd);
  const STEP_WORDS = {
    listen: 'Listen', rhythm: 'Clap the rhythm', pitches: 'Play the notes, any speed',
    'phrase-slow': 'Play it slowly', 'tempo-ladder': 'Play it up to speed',
    chain: 'Play the phrases together', whole: 'Play the whole piece',
  };
  const byHeading = {};
  for (const step of plan.steps) {
    if (!step.passRule) continue; // 'listen' steps are driven by "Next", never by notes
    const key = (STEP_WORDS[step.kind] || step.kind) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')';
    const notes = step.notes.map((n) => ({
      midi: n.midi,
      offsetSec: (n.start - step.originTick) / song.ticksPerQuarter * (60 / step.bpm),
    }));
    (byHeading[key] = byHeading[key] || []).push(notes);
  }
  return byHeading;
})();

async function playHotCrossBunsToTheEnd(page) {
  const attemptCounts = {};
  for (let i = 0; i < 40; i++) {
    const finished = await page.evaluate(
      "(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice p').textContent.includes('whole piece')"
    );
    if (finished) return;
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (hasNext) {
      await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
      continue;
    }
    // The badge (data-difficulty span) is a CHILD of the h4, so plain
    // textContent already reads "<title> (bars X-Y)Easy" -- matched with a
    // non-greedy heading capture rather than trimmed separately.
    const heading = await page.evaluate(
      "(() => { const h4 = document.querySelector('.panel-songs-practice h4'); return h4 && h4.textContent; })()"
    );
    const headingKey = heading && (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const rungs = headingKey ? HOT_CROSS_BUNS_STEPS_BY_HEADING[headingKey] : null;
    if (!rungs) { throw new Error('no known notes for step heading: ' + heading); }
    const attemptIndex = Math.min(attemptCounts[headingKey] || 0, rungs.length - 1);
    attemptCounts[headingKey] = (attemptCounts[headingKey] || 0) + 1;
    const notes = rungs[attemptIndex];
    // A tempo-ladder step's REAL bpm is step.bpm scaled by the loop transport's
    // own rate (src/ui/songs.js's effectiveBpm/backingBpm), which speeds up
    // after a clean loop -- so the on-screen "Playing at NN% speed"/"Full
    // speed" readout (src/ui/songs/loop-backing.js's rateLabel) is read here
    // and the plan's own (fixed-bpm) offsets rescaled to match, or a rung
    // reached after an earlier clean one judges these notes as late.
    const ratePct = await page.evaluate(
      "(() => { const r = document.querySelector('.panel-songs-rate'); if (!r) return 100; const m = r.textContent.match(/(\\d+)%/); return m ? Number(m[1]) : 100; })()"
    );
    const scale = 100 / Math.max(1, Math.round(100 * (ratePct / 100)));
    const scaledNotes = notes.map((n) => ({ midi: n.midi, offsetSec: n.offsetSec * scale }));
    // Click "Your turn" and wait for the real (wall-clock) count-in to end --
    // recordStartSec is set synchronously inside startRecording(), but the
    // MIDI listener that forwardNoteAt()'s events reach is only subscribed
    // once beginListening() actually runs, at the count-in's end. Once it
    // has, songsNoteAt's offsetSec is stamped exactly, whatever moment this
    // call itself lands.
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()");
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')",
      8000
    );
    await page.evaluate(
      `(() => { ${JSON.stringify(scaledNotes)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true)); })()`
    );
    await page.waitFor(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
    );
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()");
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  throw new Error('Hot Cross Buns did not reach "whole piece" within the loop budget');
}

test('no hand-off button at level 1', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  const present = await page.evaluate("!!document.getElementById('kbdSongHandoff')");
  assert.equal(present, false, 'expected no hand-off button at level 1');

  assert.deepEqual(page.exceptions, []);
});

test('the hand-off button and its unreviewed label appear once level 2 is reached via setMod re-render', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("window.__coach.setMod('kbd')");

  const btn = await page.evaluate("(document.getElementById('kbdSongHandoff') || {}).textContent");
  assert.ok(btn && btn.includes('Play a song with these notes'), 'expected the hand-off button: ' + btn);
  const label = await page.evaluate("(() => { const n = document.querySelector('#modOpts [role=\"note\"]'); return n && n.textContent; })()");
  assert.ok(label && label.includes('Not yet checked by a player'), 'expected the unreviewed label beside the button: ' + label);

  assert.deepEqual(page.exceptions, []);
});

test('the hand-off button appears after a level change with no setMod call (Skip ahead)', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('harderBtn').click()");
  const level = await page.evaluate('window.__coach.state().level');
  assert.equal(level, 2, 'Skip ahead should have moved to level 2');

  const btn = await page.evaluate("!!document.getElementById('kbdSongHandoff')");
  assert.ok(btn, 'expected the hand-off button to appear from jump() alone, without any setMod() re-render');

  assert.deepEqual(page.exceptions, []);
});

test('clicking the hand-off button opens Hot Cross Buns as a lesson on Keyboard, and "Back to practice" returns cleanly', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
  const heading = await page.evaluate("(document.getElementById('songsPracticeHeading') || {}).textContent");
  assert.equal(heading, 'Hot Cross Buns');
  // A lesson actually built (rather than startPractice()'s "Pick an
  // instrument first" fallback paragraph) is itself proof the instrument
  // named by requestOpenSong's 'kbd' resolved -- an unresolved instrument id
  // renders that fallback message instead of a practice heading/step.
  const gotFallback = await page.evaluate(
    "!!Array.from(document.querySelectorAll('.panel-songs-practice p')).find(p => p.textContent.includes('Pick an instrument'))"
  );
  assert.equal(gotFallback, false, 'expected the Keyboard instrument to resolve, not the "pick an instrument" fallback');

  await playHotCrossBunsToTheEnd(page);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Back to practice')",
    15000
  );

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Back to practice').click()"
  );

  const panelHostHidden = await page.evaluate("document.getElementById('panelHost').hidden");
  const mainAreaHidden = await page.evaluate("document.getElementById('mainArea').hidden");
  const practiceCurrent = await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').getAttribute('aria-current')");
  const mod = await page.evaluate('window.__coach.db().prefs.mod');
  assert.equal(panelHostHidden, true, 'panel host should be hidden after Back to practice');
  assert.equal(mainAreaHidden, false, 'main practice area should be visible after Back to practice');
  assert.equal(practiceCurrent, 'page', 'the Practice nav destination should read as current');
  assert.equal(mod, 'kbd', 'still on the keyboard mod (mod alone proves nothing since it never left kbd -- the panel/nav asserts above are what prove the return actually happened)');

  assert.deepEqual(page.exceptions, []);
});
