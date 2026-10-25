// "My speed" (leftovers plan F12): a 50-100 % slider in the open song slows
// every timed step -- backing, count-in and judging all read the same
// effectiveBpm() -- and a clean, counted Check try saves that speed as the
// song's best once the whole piece counts. The song list then says
// "Clean at 70%", and the next better Check says how far it came up. Notes are stamped through the debug hook
// with a 'midi' route (songsNoteAt), so a try is on time however busy the
// runner is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';
import { skipDemo } from '../helpers/songs-demo.mjs';
import { backingBpm } from '../../src/ui/songs/loop-backing.js';

const htmlPath = HTML_PATH;
const SLIDER = '.panel-songs-speed input[type="range"]';

const HCB = starterSongs.find((s) => s.id === 'hot-cross-buns');
const HCB_STEPS = buildLessonPlan(HCB, HCB.parts[0].id, instrumentById.kbd).steps;
const RHYTHM = { step: HCB_STEPS.find((s) => s.kind === 'rhythm'), tpq: HCB.ticksPerQuarter };

// Judged steps by on-screen heading, in plan order (the tempo-ladder rungs
// of one phrase share a heading, so the n-th try under it is the n-th rung).
const STEP_WORDS = {
  rhythm: 'Clap the rhythm', pitches: 'Play the notes, any speed', 'phrase-slow': 'Play it slowly',
  'tempo-ladder': 'Play it up to speed', chain: 'Play the phrases together', whole: 'Play the whole piece',
};
const BY_HEADING = {};
for (const step of HCB_STEPS) {
  if (!step.passRule) continue;
  const key = STEP_WORDS[step.kind] + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')';
  (BY_HEADING[key] = BY_HEADING[key] || []).push(step);
}

// Where each note of the rhythm step falls when the step plays at `bpm`.
function offsetsAt(bpm) {
  return RHYTHM.step.notes.map((n) => ({ midi: n.midi, offsetSec: (n.start - RHYTHM.step.originTick) / RHYTHM.tpq * (60 / bpm) }));
}

async function openSongsList(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
}

const HCB_ROW = "Array.from(document.querySelectorAll('.panel-songs-row')).find(li => li.querySelector('button') && li.querySelector('button').textContent === 'Hot Cross Buns')";

async function openHotCrossBuns(page) {
  await page.evaluate(`${HCB_ROW}.querySelector('button').click()`);
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

async function clickButtonNamed(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

async function setSpeed(page, pct) {
  await page.evaluate(`(() => { const s = document.querySelector('${SLIDER}'); s.value = '${pct}'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.waitFor(`document.querySelector('${SLIDER}') && document.querySelector('${SLIDER}').value === '${pct}'`);
}

// Check mode, Next past Listen, one on-time MIDI try of the rhythm step at `bpm`.
async function cleanCheckRhythm(page, bpm) {
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="check"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="check"]').getAttribute('aria-pressed') === 'true'`);
  await clickButtonNamed(page, 'Next');
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  const offsets = offsetsAt(bpm);
  await page.evaluate(`(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + offsets.length + "')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  return events[events.length - 1];
}

// Check mode from wherever the open song is to its end screen: Next past
// each Listen, and every judged step played on time at the tempo it really
// plays -- the rung's rate, then My speed on top. Untimed (bpm 0) steps
// get their notes half a second apart.
async function checkToEnd(page, speed) {
  const tries = {};
  for (let i = 0; i < 60; i++) {
    const heading = await page.evaluate("(document.querySelector('.panel-songs-practice h4') || {}).textContent || null");
    if (!heading) return;
    const hasNext = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')");
    if (hasNext) { await clickButtonNamed(page, 'Next'); continue; }
    const key = (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const rungs = BY_HEADING[key];
    if (!rungs) throw new Error('no known step for heading: ' + heading);
    const step = rungs[Math.min(tries[key] || 0, rungs.length - 1)];
    tries[key] = (tries[key] || 0) + 1;
    const ratePct = await page.evaluate("(() => { const r = document.querySelector('.panel-songs-rate'); const m = r && r.textContent.match(/(\\d+)%/); return m ? Number(m[1]) : 100; })()");
    const played = step.bpm > 0 ? Math.max(1, Math.round(backingBpm(step.bpm, ratePct / 100) * speed / 100)) : 0;
    const notes = step.notes.map((n, k) => ({ midi: n.midi, offsetSec: played ? (n.start - step.originTick) / HCB.ticksPerQuarter * (60 / played) : k * 0.5 }));
    const before = await page.evaluate('window.__coach.db().events.length');
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
    await page.evaluate(`(() => { ${JSON.stringify(notes)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`);
    await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + notes.length + "')");
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor('window.__coach.db().events.length > ' + before);
  }
  throw new Error('did not reach the end screen');
}

test('the slider starts at full speed and offers 50-100 %', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openSongsList(page);
  await openHotCrossBuns(page);
  const slider = await page.evaluate(`(() => { const s = document.querySelector('${SLIDER}'); return s && { min: s.min, max: s.max, step: s.step, value: s.value, label: s.labels && s.labels[0] ? s.labels[0].textContent : '' }; })()`);
  assert.deepEqual({ min: slider.min, max: slider.max, step: slider.step, value: slider.value }, { min: '50', max: '100', step: '5', value: '100' });
  assert.match(slider.label, /My speed/);
  assert.equal(await page.evaluate(`!!${HCB_ROW}.querySelector('.panel-songs-speed-best')`), false, 'no record before any clean Check');
  assert.deepEqual(page.exceptions, []);
});

test('a clean Check at 70 % is judged at 70 %, saved as the best, and survives a reload; 80 % says how far it came up', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openSongsList(page);
  await openHotCrossBuns(page);

  await setSpeed(page, 70);
  const at70 = Math.round(RHYTHM.step.bpm * 0.7);
  const row = await cleanCheckRhythm(page, at70);
  assert.equal(row.bpmTarget, RHYTHM.step.bpm, 'the target stays the written tempo');
  assert.equal(row.bpmActual, at70, 'the row says the tempo actually played');
  assert.equal(await page.evaluate("(document.querySelector('.panel-songs-check-result') || {}).textContent"), 'This try counted as a check.');
  assert.equal(await page.evaluate("!!document.querySelector('.panel-songs-speed-record')"), false, 'one clean step is not the song');

  await checkToEnd(page, 70);
  assert.equal(await page.evaluate("(document.querySelector('.panel-songs-check-result') || {}).textContent"), 'This try counted as a check.');
  assert.equal(await page.evaluate("(document.querySelector('.panel-songs-speed-record') || {}).textContent"), 'Clean at 70% speed.');

  await page.reload();
  await openSongsList(page);
  assert.equal(await page.evaluate(`(${HCB_ROW}.querySelector('.panel-songs-speed-best') || {}).textContent`), 'Clean at 70%');
  await openHotCrossBuns(page);
  assert.equal(await page.evaluate(`document.querySelector('${SLIDER}').value`), '70', 'the chosen speed is kept per song');

  await setSpeed(page, 80);
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="check"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="check"]').getAttribute('aria-pressed') === 'true'`);
  await checkToEnd(page, 80);
  assert.equal(await page.evaluate("(document.querySelector('.panel-songs-speed-record') || {}).textContent"), 'Clean at 80% speed (up from 70%).');
  assert.deepEqual(page.exceptions, []);
});

test('a clean try outside Check never sets the record', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openSongsList(page);
  await openHotCrossBuns(page);
  await setSpeed(page, 60);
  await clickButtonNamed(page, 'Next');
  await skipDemo(page);
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent.startsWith('Clap the rhythm')");
  const before = await page.evaluate('window.__coach.db().events.length');
  await clickButtonNamed(page, 'Your turn');
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  const offsets = offsetsAt(Math.round(RHYTHM.step.bpm * 0.6));
  await page.evaluate(`(() => { ${JSON.stringify(offsets)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true, 'midi')); })()`);
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('" + offsets.length + "')");
  await clickButtonNamed(page, 'Stop and check');
  await page.waitFor('window.__coach.db().events.length > ' + before);
  assert.equal(await page.evaluate("!!document.querySelector('.panel-songs-speed-record')"), false);
  assert.equal(await page.evaluate("(window.__coach.db().panels || {})['songs-speed'] && Object.values(window.__coach.db().panels['songs-speed']).some(e => e && e.best != null)"), false);
  assert.deepEqual(page.exceptions, []);
});
