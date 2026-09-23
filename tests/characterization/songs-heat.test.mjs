// Songs panel bar-by-bar heat strip (Wave W follow-up: "show which bars went
// wrong after each try"). Drives the built page through
// window.__coach.openPanel('songs') and the DOM, following the same pattern
// as tests/characterization/w-songs.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function getToRecordingStep(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );
}

test('a phrase step shows its Easy/Medium/Hard difficulty word', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const badgeText = await page.evaluate(
    "document.querySelector('.panel-songs-practice h4 .panel-songs-diff-badge[data-difficulty]').textContent"
  );
  assert.ok(['Easy', 'Medium', 'Hard'].includes(badgeText), 'unexpected difficulty word: ' + badgeText);
});

test('after a judged try, a bar-by-bar strip renders with data-grade chips', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await getToRecordingStep(page);

  // Hot Cross Buns' first phrase begins on E4 (midi 64): a correctly pitched note.
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  await page.waitFor("document.querySelectorAll('.panel-songs-bar').length > 0");
  const grades = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-bar')).map(el => el.getAttribute('data-grade'))"
  );
  assert.ok(grades.length > 0, 'expected at least one bar chip');
  grades.forEach((g) => assert.ok(['good', 'shaky', 'miss'].includes(g), 'unexpected grade: ' + g));

  assert.deepEqual(page.exceptions, []);
});

test('starting a new try clears the previous bar strip', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await getToRecordingStep(page);
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-bar').length > 0");

  // Whether the try passed or failed, the step's "Your turn" button is back
  // (a failed step repeats itself; a passed one lands on the next step,
  // which also has a passRule since it is still a phrase-level step).
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  const stripGone = await page.evaluate("document.querySelectorAll('.panel-songs-bar').length === 0");
  assert.equal(stripGone, true, 'starting a new try should clear the previous bar strip');
});
