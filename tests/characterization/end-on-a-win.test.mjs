// F7: at a tired break, or when the learner ends right after a miss, the app
// offers one item they already know well, then ends the session on it. The
// offer is optional, never adds more than that one item, and only appears
// when an item is genuinely mastered (src/core/srs.js mastered()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const profile = (prefs) => "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: " + JSON.stringify(prefs) + " }));";
const card = "(() => { const c = document.getElementById('breakCard'), w = document.getElementById('winBtn'); return { up: !c.hidden, title: document.getElementById('breakTitle').textContent, win: !w.hidden, winText: w.textContent }; })()";
// Seed the item on screen as well known: reviewed five times, seen just now, long stability.
const masterCurrent = "(() => { const id = window.__coach.cur().id; window.__coach.state().item[id] = { stability: 200, difficulty: 0.2, lastSeen: window.__coach.modelNow(), reps: 5, lapses: 0, seen: 1 }; return id; })()";

async function start(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
}
async function playRight(page) {
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
}
async function playMissThenRight(page) {
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi === 60 ? 61 : 60}, true)`);
  await page.waitFor('window.__coach.cur().failed === true');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
}
const nextTask = (page) => page.waitFor('window.__coach.task() && !window.__coach.task().done');
const makeTired = "(() => { const s = window.__coach.sess(); s.tiredFor = 20; s.active = 300; })()";

test('a tired break offers one well-known item, and playing it ends the session on a win', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await start(page);
  const id = await page.evaluate(masterCurrent);
  await page.evaluate(makeTired);
  await playRight(page);
  await page.waitFor("!document.getElementById('breakCard').hidden");
  const got = await page.evaluate(card);
  assert.equal(got.win, true, `the offer shows: ${JSON.stringify(got)}`);
  await page.clickSelector('#winBtn');
  await nextTask(page);
  assert.equal(await page.evaluate('window.__coach.cur().id'), id, 'the one item is the mastered one');
  assert.equal(await page.evaluate('window.__coach.task().warm'), true, 'it does not count against the learner');
  await playRight(page);
  await page.waitFor('window.__coach.sess() === null');
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /Ended on a win/);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('with nothing mastered yet, a tired break makes no offer', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await start(page);
  await page.evaluate(makeTired);
  await playRight(page);
  await page.waitFor("!document.getElementById('breakCard').hidden");
  assert.equal((await page.evaluate(card)).win, false);
  // The tired break fires from inside finishTask(); it must not throw on the rest of that task.
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('End right after a miss offers the win first, and End session still ends at once', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await start(page);
  await page.evaluate(masterCurrent);
  await playMissThenRight(page);
  await nextTask(page);
  await page.clickSelector('#endBtn');
  const got = await page.evaluate(card);
  assert.equal(got.up, true, 'the card asks first');
  assert.equal(got.win, true);
  assert.match(got.title, /win/i);
  await page.clickSelector('#endBtn2');
  await page.waitFor('window.__coach.sess() === null');
});

test('End after a right answer ends at once, offer or not', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  await start(page);
  await page.evaluate(masterCurrent);
  await playRight(page);
  await nextTask(page);
  await page.clickSelector('#endBtn');
  await page.waitFor('window.__coach.sess() === null');
  assert.equal((await page.evaluate(card)).up, false);
});

test('the offer is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd', locale: 'es' }) });
  t.after(() => page.close());
  await start(page);
  await page.evaluate(masterCurrent);
  await page.evaluate(makeTired);
  await playRight(page);
  await page.waitFor("!document.getElementById('breakCard').hidden");
  assert.match((await page.evaluate(card)).winText, /acierto/);
});
