// What a guitar player sees around a note: a get-ready before its timer starts, why there is no dot
// when there is none, what the heard rings mean, and the two E strings told apart. From a hand check:
// "no heads up of when the note is coming", "it told me to play G but didn't show anything", and
// "a bunch of dots all over the fret display".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const G3 = 55;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

async function begin(t, mod = 'gtr') {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`window.__coach.setMod('${mod}')`);
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.waitFor('window.__coach.task()');
  return page;
}
const widthOf = (page) => page.evaluate("parseInt(document.getElementById('timeFill').style.width, 10)");
const hideTarget = (page) => page.evaluate('(() => { const e = window.__coach.cur(); e.reveal = false; e.failed = false; window.__coach.task().limit = 1e9; })()');
const view = (page, cond) => page.waitFor(`(() => { const v = window.__coach.fretView(); return v && (${cond}); })()`);
const fv = (page) => page.evaluate('window.__coach.fretView()');

test('H1: a new note gets a get-ready with the timer held full, then a Now as the timer starts', async (t) => {
  const page = await begin(t);
  assert.equal(await page.evaluate('window.__coach.stageCue()'), 'GET READY');
  assert.equal(await widthOf(page), 100);
  await page.waitFor("window.__coach.stageCue() === 'NOW'", 5000);
  await page.waitFor("window.__coach.stageCue() === ''", 5000);
  await page.waitFor("parseInt(document.getElementById('timeFill').style.width, 10) < 100", 5000);
});

test('H2: the time limit counts from the end of the get-ready', async (t) => {
  const page = await begin(t);
  await page.evaluate('window.__coach.task().limit = 0.2');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await page.evaluate('window.__coach.cur().failed'), false, 'no timeout during the get-ready');
  await page.waitFor('window.__coach.cur().failed === true', 6000);
});

test('H3: a right note during the get-ready counts, at full speed', async (t) => {
  const page = await begin(t);
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");
  assert.match(await page.evaluate("document.getElementById('feedback').textContent"), /in 0\.0 s/);
  assert.equal(await page.evaluate('window.__coach.stageCue()'), '');
});

test('H4: a keyboard drill keeps its instant start', async (t) => {
  const page = await begin(t, 'kbd');
  assert.equal(await page.evaluate('window.__coach.stageCue()'), '');
});

test('M1: no dot says why, in the hint and on the fretboard; Show me takes the line away', async (t) => {
  const page = await begin(t);
  await hideTarget(page);
  await page.evaluate("document.getElementById('hint').textContent = ''; window.__coach.refreshPrompt()");
  await view(page, 'v.caption.includes("From memory")');
  assert.equal((await fv(page)).dots.filter((d) => d.kind === 'target').length, 0);
  assert.match(await page.evaluate("document.getElementById('hint').textContent"), /from memory.*Show me/i);
  await page.evaluate("document.getElementById('showMeBtn').click()");
  await view(page, 'v.dots.some(d => d.kind === "target")');
  await view(page, '!v.caption.includes("From memory")');
});

test('D1: the rings mark only the octave heard, not every G on the neck, and a caption says what they are', async (t) => {
  const page = await begin(t);
  await page.evaluate('window.__coach.task().limit = 1e9');
  await page.evaluate(`window.__coach.pitchFrame({ rms: 0.2, freq: ${hz(G3)}, midi: ${G3}, cents: 0, clarity: 0.99 }, 0.01)`);
  await view(page, 'v.dots.some(d => d.kind === "hint")');
  const v = await fv(page);
  const tuning = await page.evaluate("[40, 45, 50, 55, 59, 64]");
  const rings = v.dots.filter((d) => d.kind === 'hint');
  for (const d of rings) assert.equal(tuning[6 - d.string] + d.fret, G3, `string ${d.string} fret ${d.fret}`);
  assert.ok(rings.some((d) => d.string === 3 && d.fret === 0));
  assert.ok(rings.length <= 3, `${rings.length} rings`);
  assert.match(v.caption, /Ring/);
});

test('E1: the two open E strings read Low E and High E; other notes keep their plain name', async (t) => {
  const page = await begin(t);
  const name = (id) => page.evaluate(`window.__coach.inf('${id}').label.split(':')[0]`);
  assert.equal(await name('s6f0'), 'Low E');
  assert.equal(await name('s1f0'), 'High E');
  assert.equal(await name('s3f0'), 'G');
  assert.equal(await name('s4f2'), 'E');
  assert.equal(await page.evaluate("window.__coach.inf('s6f0').short"), 'E (string 6)');
});

test('E2: a wrong note with the same name gives both octaves, so it never reads "That was E, the note is E"', async (t) => {
  const page = await begin(t);
  await page.evaluate("(() => { const e = window.__coach.cur(); e.id = 's6f0'; e.info = window.__coach.inf('s6f0'); window.__coach.task().limit = 1e9; })()");
  await page.evaluate('window.__coach.note(64, true)');
  await page.waitFor("document.getElementById('feedback').className === 'no'");
  assert.match(await page.evaluate("document.getElementById('feedback').textContent"), /^That was E4, the note is E2\./);
});

test('E3: a wrong note with a different name stays short', async (t) => {
  const page = await begin(t);
  await page.evaluate("(() => { const e = window.__coach.cur(); e.id = 's6f0'; e.info = window.__coach.inf('s6f0'); window.__coach.task().limit = 1e9; })()");
  await page.evaluate('window.__coach.note(45, true)');
  await page.waitFor("document.getElementById('feedback').className === 'no'");
  assert.match(await page.evaluate("document.getElementById('feedback').textContent"), /^That was A, the note is E\./);
});
