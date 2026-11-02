// The drum "right drums, right order, no clock" step, through the built page:
// a rock groove played out of time passes it and moves on to "Clap the
// rhythm"; the wrong order stays put with a plain-word message; and a lesson
// saved before the step existed resumes on the same musical step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterById } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId } from '../../src/instruments/index.js';
import { skipDemo } from '../helpers/songs-demo.mjs';

const BTN = (label) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(label)})`;
const TITLE = "document.querySelector('.panel-songs-practice h4').textContent";
const song = starterById('groove-rock');
const plan = buildLessonPlan(song, 'kit', byId['drum-kit']);
const orderStep = plan.steps.find((s) => s.kind === 'drum-order');

async function openGroove(page) {
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-list .panel-songs-row button').length > 0");
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row > button')).find(b => b.textContent === ${JSON.stringify(song.title)}).click()`);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function toOrderStep(page) {
  await page.waitFor(`!!${BTN('Next')}`);
  await page.evaluate(`${BTN('Next')}.click()`);
  await skipDemo(page);
  await page.waitFor(`!!${BTN('Your turn')}`);
  assert.ok((await page.evaluate(TITLE)).startsWith('Play the drums in order'));
}

async function play(page, midis, gapSec) {
  await page.evaluate(`${BTN('Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
  await page.evaluate(`${JSON.stringify(midis)}.forEach((m, i) => window.__coach.songsNoteAt(m, i * ${gapSec}, true))`);
  await page.waitFor(`!!${BTN('Stop and check')}`);
  await page.evaluate(`${BTN('Stop and check')}.click()`);
}

const written = orderStep.notes.map((n) => n.midi);

test('the right drums in order, at a crawl, pass the drum-order step and move on', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openGroove(page);
  await toOrderStep(page);
  const before = await page.evaluate(TITLE);
  await play(page, written, 1.7);
  await page.waitFor(`${TITLE} !== ${JSON.stringify(before)}`, 8000);
  await skipDemo(page);
  assert.ok(!(await page.evaluate(TITLE)).startsWith('Play the drums in order'), 'moved on');
  assert.deepEqual(page.exceptions, []);
});

test('the wrong order stays on the step and says what was wrong', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openGroove(page);
  await toOrderStep(page);
  const swapped = written.slice().reverse();
  assert.notDeepEqual(swapped, written);
  await play(page, swapped, 0.6);
  await page.waitFor("document.querySelector('.panel-songs-practice') && /That was the|Missed a beat|extra/.test(document.querySelector('.panel-songs-practice').textContent)", 8000);
  assert.ok((await page.evaluate(TITLE)).startsWith('Play the drums in order'), 'still on the same step');
  assert.deepEqual(page.exceptions, []);
});

test('a drum lesson saved before the step existed resumes on the same musical step', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openGroove(page);
  await page.waitFor("(() => { try { return JSON.parse(localStorage.getItem('bandcoach.v1')).panels.songs.lessons[0].stepIndex === 0; } catch (e) { return false; } })()");
  // Rewrite the saved place as the previous release wrote it: an untagged key
  // and an index counted without the drum-order step (old index 1 = "rhythm").
  await page.evaluate(`(() => {
    const db = JSON.parse(localStorage.getItem('bandcoach.v1'));
    const e = db.panels.songs.lessons[0];
    e.key.tempo = e.key.tempo.replace('#drum-order', '');
    e.stepIndex = 1; e.tail = [{ stepIndex: 1, passed: false }];
    localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-list .panel-songs-row button').length > 0");
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row > button')).find(b => b.textContent === ${JSON.stringify(song.title)}).click()`);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  const title = await page.evaluate(TITLE);
  assert.ok(title.startsWith('Clap the rhythm'), 'landed on rhythm, not Listen or the new step: ' + title);
  assert.equal(await page.evaluate("document.getElementById('panelSay').textContent"), 'Picking up where you left off.');
  assert.deepEqual(page.exceptions, []);
});
