// A song lesson picks up at the step (and ladder speed) it was left on when
// the same song, part, arrangement, setup, instrument and tempo are still in
// play (src/song/lesson-resume.js, P5-3). Anything that changes the lesson
// starts fresh at step 1, exactly like today. See tests/characterization/
// w-songs.test.mjs:375-391 (the store's saved top-level fields, which must
// keep working) and learning-events.test.mjs:113 (the reload pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

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

async function openHotCrossBunsAndAdvanceOneStep(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  await page.waitFor(
    "(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).panels.songs.lessons[0].stepIndex === 1; } catch (e) { return false; } })()"
  );
}

test('a song lesson picks up at the same step after the app is closed and reopened', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBunsAndAdvanceOneStep(page);

  await page.reload();
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Clap the rhythm'), 'resumed on the step it was left on: ' + stepTitle);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.equal(said, 'Picking up where you left off.');

  assert.deepEqual(page.exceptions, []);
});

test('switching instrument starts the same song fresh', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBunsAndAdvanceOneStep(page);

  await page.reload();
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Listen'), 'a different instrument starts the lesson fresh: ' + stepTitle);
  const said = await page.evaluate("document.getElementById('panelSay').textContent");
  assert.equal(said, '', 'no pick-up line on a fresh start');

  assert.deepEqual(page.exceptions, []);
});

test('Practise again always starts at the first step', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-resume-'));
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

  for (let i = 0; i < 12; i++) {
    const finished = await page.evaluate(
      "(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice p').textContent.includes('whole piece')"
    );
    if (finished) break;
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (hasNext) {
      await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
      continue;
    }
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
    );
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
    );
    await page.evaluate("window.__coach.songsNote(64, true)");
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
    await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
    );
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Practise again')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Practise again').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Listen'), '"Practise again" always starts fresh: ' + stepTitle);

  assert.deepEqual(page.exceptions, []);
});

test('the Carry on button reopens the unfinished lesson', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await openHotCrossBunsAndAdvanceOneStep(page);

  await page.reload();
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.panel-songs-carry-on')");
  const label = await page.evaluate("document.querySelector('.panel-songs-carry-on').textContent");
  assert.ok(label.includes('Hot Cross Buns'), 'names the most recent unfinished lesson: ' + label);

  await page.evaluate("document.querySelector('.panel-songs-carry-on').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Clap the rhythm'), 'lands on the step it was left on: ' + stepTitle);

  assert.deepEqual(page.exceptions, []);
});
