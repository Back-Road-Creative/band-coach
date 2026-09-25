// Songs uses the arrangement (P4-7): under the song title, one plain-words
// line naming how THIS instrument's saved setup and the song's own key
// change what the learner is about to see -- capo/tuning, a voice range
// moving the key, or a written-pitch note for a transposing instrument.
// Drives the built page the same way tests/characterization/w-songs.test.mjs
// and songs-feasibility.test.mjs do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('a saved capo reaches the song', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate(`(function () {
    const capo = document.getElementById('fingCapo');
    capo.value = '2'; capo.dispatchEvent(new Event('change'));
  })()`);
  await page.evaluate('window.__coach.closePanel()');

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-arrangement') && document.querySelector('.panel-songs-arrangement').textContent.includes('capo 2')"
  );

  const text = await page.evaluate("document.querySelector('.panel-songs-arrangement').textContent");
  assert.match(text, /capo 2/);
  assert.deepEqual(page.exceptions, []);
});

test('a measured voice range moves the song', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate('window.__coach.db().prefs.voiceRange={low:43,high:57}');
  await page.evaluate("window.__coach.setMod('voice')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-arrangement') && document.querySelector('.panel-songs-arrangement').textContent.includes('Moved down')"
  );

  const text = await page.evaluate("document.querySelector('.panel-songs-arrangement').textContent");
  assert.match(text, /Moved down/);
  assert.deepEqual(page.exceptions, []);
});

test('clarinet says it is written higher than it sounds', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-instrument-card').length > 0");
  await page.evaluate(
    "(function () { const card = Array.from(document.querySelectorAll('.panel-songs-instrument-card')).find(c => c.textContent.includes('Clarinet')); card.querySelector('button').click(); })()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-arrangement') && document.querySelector('.panel-songs-arrangement').textContent.includes('a tone higher')"
  );

  const text = await page.evaluate("document.querySelector('.panel-songs-arrangement').textContent");
  assert.match(text, /a tone higher/);
  assert.deepEqual(page.exceptions, []);
});
