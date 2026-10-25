// "Hear your try" (leftovers plan F15): no sound is ever recorded, so after
// a judged try the step offers a button that rebuilds the try from the
// notes it heard -- each at its own offset -- and then plays the target
// phrase. The spy is the debug hook's tone trail (window.__coach.tones(),
// every tone the app scheduled, with its audio-clock start), so the test
// reads what was actually handed to the synth. Notes are stamped through
// songsNoteAt with a 'midi' route, so a try is on time however busy the
// runner is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

const HCB = starterSongs.find((s) => s.id === 'hot-cross-buns');
const STEPS = buildLessonPlan(HCB, HCB.parts[0].id, instrumentById.kbd).steps;
const RHYTHM = STEPS.find((s) => s.kind === 'rhythm');
const PITCHES = STEPS.find((s) => s.kind === 'pitches');
const SLOW = STEPS.find((s) => s.kind === 'phrase-slow');
const BUTTON = 'Hear your try';

function offsets(step, midis) {
  return step.notes.map((n, k) => ({
    midi: midis ? midis[k] : n.midi,
    offsetSec: step.bpm > 0 ? (n.start - step.originTick) / HCB.ticksPerQuarter * (60 / step.bpm) : k * 0.5,
  }));
}

async function clickButtonNamed(page, text) {
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
}
const hasButton = (page, text) => page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === ${JSON.stringify(text)})`);

async function tryStep(page, notes) {
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
  await page.evaluate(`(() => { ${JSON.stringify(notes)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + notes.length + "')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before);
}

test('Hear your try plays the captured notes, wrong pitch included, then the target', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="check"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="check"]').getAttribute('aria-pressed') === 'true'`);
  await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  assert.equal(await hasButton(page, BUTTON), false, 'nothing to hear before a try');
  await tryStep(page, offsets(RHYTHM));
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play the notes')");
  await tryStep(page, offsets(PITCHES));
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')");

  const target = SLOW.notes.map((n) => n.midi);
  const wrong = target.slice();
  wrong[1] = target[1] + 1;
  const played = offsets(SLOW, wrong);
  await tryStep(page, played);
  assert.ok(await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play it slowly')"), 'the wrong note fails the step');

  const toneCount = await page.evaluate('window.__coach.tones().length');
  await clickButtonNamed(page, BUTTON);
  const heard = (await page.evaluate('window.__coach.tones()')).slice(toneCount);
  assert.deepEqual(heard.map((x) => x.midi), wrong.concat(target), 'the try as played, then the target');
  played.forEach((n, k) => {
    assert.ok(Math.abs((heard[k].at - heard[0].at) - (n.offsetSec - played[0].offsetSec)) < 0.01, `note ${k} at its captured offset`);
  });
  assert.ok(heard[played.length].at > heard[played.length - 1].at, 'the target starts after the try');
  assert.deepEqual(page.exceptions, []);
});
