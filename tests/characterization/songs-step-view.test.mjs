// P4-8: the step's bars appear as real staff notation, in the instrument's
// own written pitch, between the step title and "Play it" -- drives the
// built page the same way songs-arrangement.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the step shows its notes on a staff', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-view[data-view=\"staff\"] canvas[aria-label]')");

  const label = await page.evaluate(
    "document.querySelector('.panel-songs-view[data-view=\"staff\"] canvas').getAttribute('aria-label')"
  );
  assert.match(label, /^Bars 1-/);
  assert.deepEqual(page.exceptions, []);
});

test('clarinet reads in written pitch', async (t) => {
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
    "document.querySelector('.panel-songs-view[data-view=\"staff\"] canvas') && document.querySelector('.panel-songs-view[data-view=\"staff\"] canvas').getAttribute('aria-label').includes('F♯')"
  );

  const label = await page.evaluate(
    "document.querySelector('.panel-songs-view[data-view=\"staff\"] canvas').getAttribute('aria-label')"
  );
  assert.match(label, /F♯/);
  assert.deepEqual(page.exceptions, []);
});
