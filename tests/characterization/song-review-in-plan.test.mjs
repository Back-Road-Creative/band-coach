// F5: a song review queued in an earlier session shows up where the learner
// starts, not only inside Songs: today's plan line names it first, and a
// button beside the instrument options opens that song at the review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const review = (over = {}) => ({ songId: 'hot-cross-buns', partId: 'melody', instrumentId: 'kbd', phraseIndex: null, bars: [2, 3], kind: 'whole', at: 1, title: 'Hot Cross Buns', ...over });
const profile = (mod, items) => `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: ${JSON.stringify(mod)} }, panels: { 'songs-review': { v: 1, items: ${JSON.stringify(items)} } } }));`;
const button = "(() => { const b = document.getElementById('songReviewHandoff'); return b ? b.textContent : null; })()";

test('a review due on this instrument leads the plan line and opens Songs at the review', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: profile('kbd', [review()]) });
  t.after(() => page.close());
  assert.equal(await page.evaluate(button), 'Review Hot Cross Buns, bars 3-4');
  await page.evaluate('window.__coach.startWithoutMic()');
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /Today: review Hot Cross Buns, bars 3-4/);
  await page.evaluate("window.__coach.stopSession ? window.__coach.stopSession() : document.getElementById('endBtn').click()");
  await page.clickSelector('#songReviewHandoff');
  await page.waitFor("!!document.querySelector('.panel-songs-practice')", 8000);
  assert.match(await page.evaluate("document.querySelector('.panel-songs-practice').textContent"), /Review from last time: bars 3-4/);
  assert.deepEqual(page.exceptions, []);
});

test('a review queued for another instrument, or queued this session, is not offered', async (t) => {
  const other = await launchPage(HTML_PATH, { initScript: profile('kbd', [review({ instrumentId: 'gtr' })]) });
  t.after(() => other.close());
  assert.equal(await other.evaluate(button), null);

  const fresh = await launchPage(HTML_PATH, { initScript: profile('kbd', [review({ at: Date.now() + 86400000 })]) });
  t.after(() => fresh.close());
  assert.equal(await fresh.evaluate(button), null, 'not due until a later session');
});

test('the button is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd', locale: 'es' }, panels: { 'songs-review': { v: 1, items: [${JSON.stringify(review())}] } } }));` });
  t.after(() => page.close());
  assert.equal(await page.evaluate(button), 'Repasar Hot Cross Buns, compases 3-4');
});
