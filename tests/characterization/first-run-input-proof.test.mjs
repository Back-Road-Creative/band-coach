// F4: a brand-new learner's first instrument pick asks for any note (#inputProof). The first clean note heard is
// named ("Heard A4"); a mic that delivers only silence gets input-diagnosis.js's own line; "Just look around"
// runs drills that score nothing and log no history row. Driven through the real mic pipeline with
// window.__coach.testPluck, as the F6 tune-drift test does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const card = "(() => { const n = document.getElementById('inputProof'); return { hidden: n.hidden, say: document.getElementById('inputProofSay').textContent }; })()";

async function firstPick(t, modId) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.clickSelector(`#picker button[data-mod="${modId}"]`);
  return page;
}

test('a first guitar pick asks for a note, and a plucked A4 is named within 3 seconds', async (t) => {
  const page = await firstPick(t, 'gtr');
  assert.equal((await page.evaluate(card)).hidden, false, 'the proof card shows after the first instrument pick');
  await page.evaluate('window.__coach.testPluck(440, [0, 600])');
  await page.waitFor("/Heard A4/.test(document.getElementById('inputProofSay').textContent)", 3000);
  assert.equal(await page.evaluate("document.getElementById('inputProofConnect').hidden"), true, 'nothing left to connect once a note is heard');
  await page.clickSelector('#playBtn');
  await page.waitFor('window.__coach.task()');
  assert.equal((await page.evaluate(card)).hidden, true, 'Start puts the card away');
  assert.deepEqual(page.exceptions, []);
});

test('a mic that delivers only silence gets the diagnosis line, not a heard note', async (t) => {
  const page = await firstPick(t, 'gtr');
  await page.evaluate('window.__coach.testPluck(440, [60000])'); // the mic chain runs, but the only attack is a minute away
  await page.waitFor("/not hearing anything/i.test(document.getElementById('inputProofSay').textContent)", 9000);
  assert.doesNotMatch((await page.evaluate(card)).say, /Heard/);
  assert.deepEqual(page.exceptions, []);
});

test('the proof card never shows for a learner who already has practice logged', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.db().sessions.push({ d: '2026-10-01', mod: 'gtr', min: 5, acc: 0.8, a1: 0.8, a2: 0.8, from: 1, to: 1, breaks: 0 })");
  await page.clickSelector('#picker button[data-mod="gtr"]');
  assert.equal((await page.evaluate(card)).hidden, true);
});

async function playTen(page) {
  await page.clickSelector('#playBtn');
  for (let i = 0; i < 10; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
  }
  await page.clickSelector('#endBtn');
}

test('"Just look around" labels the drills, scores nothing and logs no history row', async (t) => {
  const page = await firstPick(t, 'kbd');
  await page.clickSelector('#inputProofLook');
  assert.equal((await page.evaluate(card)).hidden, true);
  assert.equal(await page.evaluate("document.getElementById('exploreBanner').hidden"), false, 'the exploration banner shows');
  await playTen(page);
  const db = await page.evaluate('(() => { const d = window.__coach.db(); return { sessions: d.sessions.length, events: d.events.length, judged: window.__coach.state().judged }; })()');
  assert.deepEqual(db, { sessions: 0, events: 0, judged: 0 });
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /nothing was scored/i);
  assert.deepEqual(page.exceptions, []);
});

test('control: the same ten notes without "Just look around" are scored and logged', async (t) => {
  const page = await firstPick(t, 'kbd');
  await playTen(page);
  const db = await page.evaluate('(() => { const d = window.__coach.db(); return { sessions: d.sessions.length, events: d.events.length }; })()');
  assert.equal(db.sessions, 1, 'ten judged notes log a session row');
  assert.ok(db.events >= 10, `events: ${db.events}`);
});

test('"Score my playing" leaves exploration', async (t) => {
  const page = await firstPick(t, 'kbd');
  await page.clickSelector('#inputProofLook');
  await page.clickSelector('#exploreStop');
  assert.equal(await page.evaluate("document.getElementById('exploreBanner').hidden"), true);
  await page.clickSelector('#playBtn');
  await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.db().events.length >= 1', 5000);
});
