// F1: Progress ("My progress") also renders the summarizeEvents() counts
// (src/core/learning-events.js) -- withHelp/independent/retained/applied --
// alongside the existing #historySummary block, in plain labelled words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const T0 = 1700000000000;

// Three instrument+skill 'kbd'/'s1' independent-ok events plus one
// instrument+skill 'kbd'/'s2' assisted event, timed so summarizeEvents
// (src/core/learning-events.js:111) counts: withHelp=1, independent=3,
// retained=1 (evA -> evC, 21h apart, over the 20h RETAIN_GAP_MS default),
// applied=1 (evB is song-sourced and lands after evA, the earlier
// non-song independent-ok row for the same instrument+skill).
function makeEvents() {
  const base = { v: 1, assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 1000 };
  return [
    Object.assign({}, base, { id: 'evA', at: T0, instrument: 'kbd', skill: 's1', source: 'drill' }),
    Object.assign({}, base, { id: 'evB', at: T0 + 1000, instrument: 'kbd', skill: 's1', source: 'song', songId: 'song1' }),
    Object.assign({}, base, { id: 'evC', at: T0 + 21 * 3600 * 1000, instrument: 'kbd', skill: 's1', source: 'drill' }),
    Object.assign({}, base, { id: 'evD', at: T0 + 2000, instrument: 'kbd', skill: 's2', assistance: 'shown', source: 'drill' }),
  ];
}

async function seedEvents(page, events) {
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.events = ${JSON.stringify(events)};
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
}

test('Progress shows passed-with-help/passed-on-your-own/retained/applied counts from DB.events', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seedEvents(page, makeEvents());
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'history');

  const text = await page.evaluate("document.getElementById('historyRetention').textContent");
  assert.match(text, /Passed with help:\s*1/);
  assert.match(text, /Passed on your own:\s*3/);
  assert.match(text, /Retained on a later check:\s*1/);
  assert.match(text, /Applied in a song:\s*1/);
});

test('Progress never claims a retained count with no checks recorded', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seedEvents(page, []);
  await page.evaluate('window.__coach.openPanel("history")');

  const text = await page.evaluate("document.getElementById('historyRetention').textContent");
  assert.match(text, /No checks recorded yet/);
  assert.doesNotMatch(text, /Retained on a later check:\s*[1-9]/);
});
