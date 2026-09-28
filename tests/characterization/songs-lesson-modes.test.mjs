// A song lesson has three modes on one control -- Learn (default, same as
// today), Rehearse (views/hint show, "Play it" hidden) and Check (the whole
// step view, fingering line, hint and "Play it" all hidden; assistance is
// 'none'; Check never reads or writes the saved-place `lessons` list and
// always starts at step 1). See src/ui/songs.js startPractice/renderPractice
// and src/core/learning-events.js isIndependentOk (the same predicate used
// here to decide the "counted"/"practice only" line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';
import { en } from '../../src/core/i18n.js';

const htmlPath = HTML_PATH;

// Hot Cross Buns on kbd: step 1 is 'rhythm' (3 notes, bpm 100), step 2 is
// 'pitches' (3 notes, bpm 0, untimed) -- offsets computed from the same
// plan the app builds, the tests/characterization/kbd-practice-song-
// handoff.test.mjs:32-50 pattern.
const HOT_CROSS_BUNS_PLAN = (() => {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const plan = buildLessonPlan(song, song.parts[0].id, instrumentById.kbd);
  return { song, plan };
})();

function rhythmOffsets() {
  const step = HOT_CROSS_BUNS_PLAN.plan.steps.find((s) => s.kind === 'rhythm');
  const tpq = HOT_CROSS_BUNS_PLAN.song.ticksPerQuarter;
  return step.notes.map((n) => ({ midi: n.midi, offsetSec: (n.start - step.originTick) / tpq * (60 / step.bpm) }));
}

async function openHotCrossBuns(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function clickMode(page, mode) {
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').click()`);
}

async function clickButtonNamed(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Note',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-song', title: 'One Note Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

async function playOneNoteToTheEnd(page) {
  for (let i = 0; i < 12; i++) {
    const finished = await page.evaluate(
      "(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice p').textContent.includes('whole piece')"
    );
    if (finished) return;
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (hasNext) { await clickButtonNamed(page, 'Next'); continue; }
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
    );
    await page.evaluate('window.__coach.songsNoteAt(64, 0, true)');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  throw new Error('One Note Song did not reach "whole piece" within the loop budget');
}

test('Check hides help and logs a counted MIDI row, an unrouted one as practice only', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);

  // Learn (default): everything shows.
  assert.ok(await page.evaluate("!!document.querySelector('.panel-songs-view')"), 'expected the step view in Learn');
  assert.ok(await page.evaluate("!!document.querySelector('.panel-songs-fingering')"), 'expected the fingering line in Learn');
  assert.ok(
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Play it')"),
    'expected a Play it button in Learn'
  );

  await clickMode(page, 'check');
  const heading = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(heading.startsWith('Listen'), 'Check still starts at step 1: ' + heading);
  assert.ok(!(await page.evaluate("!!document.querySelector('.panel-songs-view')")), 'expected no step view in Check');
  assert.ok(!(await page.evaluate("!!document.querySelector('.panel-songs-fingering')")), 'expected no fingering line in Check');
  assert.ok(
    !(await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Play it')")),
    'expected no Play it button in Check'
  );
  assert.ok(
    !(await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice p')).some(p => p.textContent === 'Just listen this time.')")),
    'expected no step hint in Check'
  );

  await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");

  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor(
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );
  const offsets = rhythmOffsets();
  await page.evaluate(
    `(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`
  );
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + offsets.length + "')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.skill, 'rhythm:0');
  assert.equal(row.assistance, 'none');
  assert.equal(row.input, 'midi');
  const resultText = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
  assert.equal(resultText, en['songs.mode.counted']);

  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play the notes')");
  const before2 = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor(
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );
  await page.evaluate(
    `(() => { [
      { midi: 64, offsetSec: 0.2 },
      { midi: 62, offsetSec: 0.5 },
      { midi: 60, offsetSec: 0.8 },
    ].forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true)); })()`
  );
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('3')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before2);

  const events2 = await page.evaluate('window.__coach.db().events');
  const row2 = events2[events2.length - 1];
  assert.equal(row2.input, 'unknown');
  const resultText2 = await page.evaluate("document.querySelector('.panel-songs-check-result').textContent");
  assert.equal(resultText2, en['songs.mode.practiceOnly']);

  assert.deepEqual(page.exceptions, []);
});

test('Learn logs a shown row with no check-result line', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");

  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor(
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );
  const offsets = rhythmOffsets();
  await page.evaluate(
    `(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`
  );
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + offsets.length + "')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.assistance, 'shown');
  assert.equal(row.input, 'midi');
  assert.ok(!(await page.evaluate("!!document.querySelector('.panel-songs-check-result')")), 'no check-result line in Learn');

  assert.deepEqual(page.exceptions, []);
});

test('Check never reads or writes the saved place; Rehearse shares Learn\'s', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickButtonNamed(page, 'Next');
  await page.waitFor(
    "(() => { try { const l = JSON.parse(localStorage.getItem('bandcoach.v1')).panels.songs.lessons[0]; return l.stepIndex === 1 && l.key.assist === 'shown'; } catch (e) { return false; } })()"
  );

  await clickMode(page, 'check');
  const heading = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(heading.startsWith('Listen'), 'Check always starts at step 1: ' + heading);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.ok(!said.includes('Picking up where you left off.'), 'Check must not say it is resuming: ' + said);

  // The live DB, not localStorage: store.set() reaches localStorage only
  // through app.js's debounced save(), so a storage read right after the
  // Check click would still show Learn's write whatever Check did.
  const stillSaved = await page.evaluate(
    "(() => { const ls = window.__coach.db().panels.songs.lessons; return ls.length === 1 && ls[0].stepIndex === 1 && ls[0].key.assist === 'shown'; })()"
  );
  assert.ok(stillSaved, 'Check must not overwrite the saved place');

  await clickMode(page, 'rehearse');
  const heading2 = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(heading2.startsWith('Clap the rhythm'), 'Rehearse shares Learn\'s saved place: ' + heading2);
  assert.ok(
    !(await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Play it')")),
    'expected no Play it button in Rehearse'
  );
  assert.ok(await page.evaluate("!!document.querySelector('.panel-songs-view')"), 'expected the step view in Rehearse');

  assert.deepEqual(page.exceptions, []);
});

test('a legacy \'none\'-keyed saved place is migrated to \'shown\' on the next open', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBuns(page);
  await clickButtonNamed(page, 'Next');
  await page.waitFor(
    "(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).panels.songs.lessons[0].stepIndex === 1; } catch (e) { return false; } })()"
  );
  await page.evaluate("window.__coach.db().panels.songs.lessons[0].key.assist = 'none'");

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const heading = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(heading.startsWith('Clap the rhythm'), 'expected the legacy entry to still resume: ' + heading);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.equal(said, 'Picking up where you left off.');

  const lessons = await page.evaluate("window.__coach.db().panels.songs.lessons");
  const hcbEntries = lessons.filter((e) => e.key.songId === 'hot-cross-buns');
  assert.equal(hcbEntries.length, 1, 'expected exactly one hot-cross-buns saved entry: ' + JSON.stringify(lessons));
  assert.equal(hcbEntries[0].key.assist, 'shown', 'expected the legacy entry migrated to the shown key');

  assert.deepEqual(page.exceptions, []);
});

test('Practise again keeps returnTo', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-modes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const libId = await page.evaluate('window.__coach.db().panels.songs.songId');

  await page.evaluate(
    `window.__coach.db().panels['songs-open-request'] = { songId: ${JSON.stringify(libId)}, partId: 'melody', instrumentId: 'kbd', returnTo: 'kbd' }`
  );
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("(document.getElementById('songsPracticeHeading') || {}).textContent === 'One Note Song'");

  await playOneNoteToTheEnd(page);
  assert.ok(
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === '" + en['kbd.songHandoff.back'] + "')"),
    'expected Back to practice after the first play-through'
  );

  await clickButtonNamed(page, 'Practise again');
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await playOneNoteToTheEnd(page);
  assert.ok(
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === '" + en['kbd.songHandoff.back'] + "')"),
    'expected Back to practice after Practise again'
  );

  assert.deepEqual(page.exceptions, []);
});
