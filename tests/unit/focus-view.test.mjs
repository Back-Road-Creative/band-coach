// F8: a running session is a focus view. The energy card and "What the coach
// is leaning on" fold away while practising (body.practising, set by
// startSession), so the instrument, the prompt, the objective, the feedback and
// the live stats keep the room; End brings them back. The opt-in "music stand" setting shows the prompt 1.5x
// while practising, for reading it from a stand an arm's length away, and is
// remembered like any other preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const H = (id) => `document.getElementById('${id}').getBoundingClientRect().height`;
const ZOOM = "Number(getComputedStyle(document.getElementById('prompt')).zoom || 1)";

async function start(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("document.body.classList.contains('practising')");
}

test('a session folds the energy card and the weak-list card away, and End brings the energy card back', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.ok(await page.evaluate(H('energyCard')) > 0, 'the energy card shows before Start');
  await start(page);
  assert.equal(await page.evaluate(H('energyCard')), 0, 'the energy card is folded away while practising');
  await page.evaluate("document.getElementById('weakCard').hidden = false");
  assert.equal(await page.evaluate(H('weakCard')), 0, 'the weak-list card is folded away while practising, even with content');
  assert.ok(await page.evaluate(H('cv')) > 0, 'the instrument stays');
  assert.ok(await page.evaluate(H('endBtn')) > 0, 'End session stays');
  assert.equal(await page.evaluate(ZOOM), 1, 'the music stand view is off by default');
  await page.evaluate("document.getElementById('endBtn').click()");
  await page.waitFor("!document.body.classList.contains('practising')");
  assert.ok(await page.evaluate(H('energyCard')) > 0, 'End brings the energy card back');
});

test('the music stand setting shows the prompt 1.5x while practising, only while practising, and is remembered', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  assert.equal(await page.evaluate("document.getElementById('optStand').checked"), false, 'off by default');
  await page.evaluate("document.getElementById('optStand').click()");
  assert.equal(await page.evaluate('window.__coach.db().prefs.stand'), true, 'the setting is saved');
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.equal(await page.evaluate(ZOOM), 1, 'no bigger prompt before Start');
  await start(page);
  assert.equal(await page.evaluate(ZOOM), 1.5, 'the prompt is 1.5x while practising');
  await page.evaluate("document.getElementById('endBtn').click()");
  await page.waitFor("!document.body.classList.contains('practising')");
  assert.equal(await page.evaluate(ZOOM), 1, 'back to normal at End');
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  assert.equal(await page.evaluate("document.getElementById('optStand').checked"), true, 'remembered after a reload');
  assert.equal(await page.evaluate('window.__coach.db().prefs.stand'), true);
});
