// "Not assessed" labels after every judged try (plan P4-10): a short list
// under the bar strip names every dimension the app could grade -- notes,
// timing, holding notes, in tune -- so a dimension the step never judges
// says so in plain words instead of just staying silent. Drives the built
// page through window.__coach.openPanel('songs') and the DOM, following the
// same pattern as tests/characterization/songs-heat.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('a clapped rhythm says the notes were not assessed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

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
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );

  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );

  await page.waitFor("document.querySelector('.panel-songs-assessed li[data-dim=\"pitch\"][data-state=\"not-assessed\"]')");
  const text = await page.evaluate(
    "document.querySelector('.panel-songs-assessed li[data-dim=\"pitch\"]').textContent"
  );
  assert.match(text, /Not assessed/);
  assert.match(text, /Notes/);

  assert.deepEqual(page.exceptions, []);
});
