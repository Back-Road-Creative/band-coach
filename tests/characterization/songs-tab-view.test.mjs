// P4-9: a fretted step shows a tab under the staff, drawn from the
// arrangement's saved capo/tuning; bowed/keys/harmonica steps show a plain-
// words fingering line instead. Drives the built page the same way
// songs-arrangement.test.mjs and songs-step-view.test.mjs do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('guitar shows a tab using the saved capo', async (t) => {
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
  await page.waitFor("document.querySelector('.panel-songs-view[data-view=\"tab\"][data-capo=\"2\"] canvas[aria-label]')");

  const label = await page.evaluate(
    "document.querySelector('.panel-songs-view[data-view=\"tab\"] canvas').getAttribute('aria-label')"
  );
  assert.match(label, /^Tab, capo 2:/);
  assert.deepEqual(page.exceptions, []);
});

test('violin shows a fingering line', async (t) => {
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
    "(function () { const card = Array.from(document.querySelectorAll('.panel-songs-instrument-card')).find(c => c.textContent.includes('Violin')); card.querySelector('button').click(); })()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-fingering') && document.querySelector('.panel-songs-fingering').textContent.includes('string')"
  );

  const text = await page.evaluate("document.querySelector('.panel-songs-fingering').textContent");
  assert.match(text, /string/);
  assert.deepEqual(page.exceptions, []);
});
