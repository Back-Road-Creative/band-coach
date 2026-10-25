// F20: on the drum kit, Songs lists the starter grooves
// (src/song/starter/grooves.js) instead of the pitched tunes it cannot
// play, and a groove played on time passes its step. Notes go in through
// window.__coach.songsNoteAt, stamped from the attempt start as in
// tests/characterization/songs-note-at.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterById, starterGrooves } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId } from '../../src/instruments/index.js';
import { skipDemo } from '../helpers/songs-demo.mjs';

const BTN = (label) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(label)})`;
const TITLE = "document.querySelector('.panel-songs-practice h4').textContent";

const rowTitles = (page) => page.evaluate("Array.from(document.querySelectorAll('.panel-songs-list .panel-songs-row > button')).map(b => b.textContent)");

async function openSongs(page, mod) {
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-list .panel-songs-row button').length > 0");
}

test('the drum kit lists the grooves, a melody instrument lists the tunes', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await openSongs(page, 'drum-kit');
  const kit = await rowTitles(page);
  const grooveTitles = starterGrooves.map((s) => s.title);
  assert.ok(grooveTitles.length >= 6);
  for (const title of grooveTitles) assert.ok(kit.includes(title), `drum kit lists ${title}`);
  assert.ok(!kit.includes('Hot Cross Buns'), 'no pitched tune on the drum kit');

  await openSongs(page, 'kbd');
  const keys = await rowTitles(page);
  assert.ok(keys.includes('Hot Cross Buns'));
  for (const title of grooveTitles) assert.ok(!keys.includes(title), `keyboard does not list ${title}`);
  assert.deepEqual(page.exceptions, []);
});

test('a rock beat played on time passes its first judged step', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  const song = starterById('groove-rock');
  const step = buildLessonPlan(song, 'kit', byId['drum-kit']).steps.find((s) => s.passRule);
  const notes = step.notes.map((n) => ({ midi: n.midi, offsetSec: (n.start - step.originTick) / song.ticksPerQuarter * (60 / step.bpm) }));

  await openSongs(page, 'drum-kit');
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row > button')).find(b => b.textContent === ${JSON.stringify(song.title)}).click()`);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.waitFor(`!!${BTN('Next')}`);
  await page.evaluate(`${BTN('Next')}.click()`);
  await skipDemo(page);
  await page.waitFor(`!!${BTN('Your turn')}`);
  const judgedTitle = await page.evaluate(TITLE);

  await page.evaluate(`${BTN('Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
  await page.evaluate(`${JSON.stringify(notes)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true))`);
  await page.waitFor(`!!${BTN('Stop and check')}`);
  await page.evaluate(`${BTN('Stop and check')}.click()`);
  await page.waitFor(`${TITLE} !== ${JSON.stringify(judgedTitle)}`, 8000);

  assert.notEqual(await page.evaluate(TITLE), judgedTitle, 'the step passed and the lesson moved on');
  assert.deepEqual(page.exceptions, []);
});
