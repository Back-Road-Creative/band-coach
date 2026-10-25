// F2: before the first session on a string instrument, the side rail offers to
// tune first. "Tune first" opens the tuner on that instrument's own strings;
// "Skip" hides the offer for good on this device. Keyboard never sees it, and
// neither does an instrument the learner has already practised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const ASKED = 'bandcoach.v1.tuneAsked';
const offer = "(() => { const n = document.getElementById('tuneFirst'); return { hidden: n.hidden, text: document.getElementById('tuneFirstText').textContent }; })()";
const profile = (prefs, extra = '') => `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: ${JSON.stringify(prefs)}${extra} }));`;

test('violin with nothing practised yet: the offer shows, and Tune first opens the tuner on G D A E', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'violin' }) });
  t.after(() => page.close());
  const got = await page.evaluate(offer);
  assert.equal(got.hidden, false, 'the offer shows before the first violin session');
  assert.match(got.text, /tune first/i, `got: ${JSON.stringify(got.text)}`);
  await page.clickSelector('#tuneFirstGo');
  // #optTune is the tuner's own instrument choice; it exists only while the tuner is open.
  assert.equal(await page.evaluate("document.querySelector('#picker button[aria-pressed=\"true\"]').dataset.mod"), 'tuner');
  assert.equal(await page.evaluate("document.getElementById('optTune').value"), 'violin', 'the tuner listens for the violin strings');
  assert.equal(await page.evaluate("document.getElementById('tuneFirst').hidden"), true);
  assert.deepEqual(JSON.parse(await page.evaluate(`localStorage.getItem(${JSON.stringify(ASKED)})`)), ['violin']);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('keyboard never gets the offer', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'kbd' }) });
  t.after(() => page.close());
  assert.equal((await page.evaluate(offer)).hidden, true);
});

test('Skip hides the offer and it stays hidden after a reload', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); ${profile({ mod: 'gtr' })} }` });
  t.after(() => page.close());
  assert.equal((await page.evaluate(offer)).hidden, false, 'guitar with nothing practised gets the offer');
  await page.clickSelector('#tuneFirstSkip');
  assert.equal((await page.evaluate(offer)).hidden, true);
  assert.equal(await page.evaluate("document.getElementById('optTune')"), null, 'Skip stays on the instrument, not the tuner');
  assert.equal(await page.evaluate('window.__coach.db().prefs.mod'), 'gtr');
  // The page's localStorage write reaches the browser process asynchronously; a reload under load
  // can otherwise start the new document before it lands (seen once with two suites running).
  await new Promise((r) => setTimeout(r, 1000));
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  assert.equal((await page.evaluate(offer)).hidden, true, 'still hidden after a reload');
});

test('an instrument already practised gets no offer, and Start hides it', async (t) => {
  const done = await launchPage(HTML_PATH, { initScript: profile({ mod: 'violin' }, `, sessions: [{ d: '2026-10-01', mod: 'violin', min: 5, acc: 0.8 }]`) });
  t.after(() => done.close());
  assert.equal((await done.evaluate(offer)).hidden, true, 'a violin session is already logged');

  const fresh = await launchPage(HTML_PATH, { initScript: profile({ mod: 'violin' }) });
  t.after(() => fresh.close());
  assert.equal((await fresh.evaluate(offer)).hidden, false);
  await fresh.evaluate('window.__coach.startWithoutMic()');
  assert.equal((await fresh.evaluate(offer)).hidden, true, 'starting a session puts the offer away');
});

test('the offer is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile({ mod: 'violin', locale: 'es' }) });
  t.after(() => page.close());
  assert.match((await page.evaluate(offer)).text, /afinar primero/i);
  assert.equal(await page.evaluate("document.getElementById('tuneFirstGo').textContent"), 'Afinar primero');
});
