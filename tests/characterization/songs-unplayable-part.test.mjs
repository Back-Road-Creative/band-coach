// A song whose every note is unplayable on the chosen instrument (Mary Had a
// Little Lamb on the drum kit) has a zero-step lesson plan. It must say so
// plainly -- never "Nicely done. You have played through the whole piece." and
// never a passed mark the learner did not earn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('a card whose notes all skip does not claim the piece was played or mark it passed', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Mary Had a Little Lamb').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-instrument-btn')).find(b => b.textContent.startsWith('Drum kit')).click()");
  await page.waitFor("document.querySelector('.panel-songs-practice')");
  const text = await page.evaluate("document.querySelector('.panel-songs-practice').textContent");
  assert.doesNotMatch(text, /Nicely done/, 'no false success screen');
  assert.match(text, /cannot be played|can't be played|none of/i, 'says why nothing can be practised');
  assert.match(text, /Back to songs/, 'still offers a way out');
  // Real store: api.store('songs-progress') lives in DB.panels, keyed by song id.
  const passed = await page.evaluate("JSON.stringify((window.__coach.db().panels || {})['songs-progress'] || {})");
  assert.deepEqual(JSON.parse(passed), {}, 'song not marked passed in the progress store');
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Back to songs').click()");
  const rows = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent).join('|')");
  assert.match(rows, /Mary Had a Little Lamb(\||$)/, 'Mary row present and has no (passed) suffix');
  assert.doesNotMatch(rows, /\(passed\)/, 'no song shows a passed mark');
});
