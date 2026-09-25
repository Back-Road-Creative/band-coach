// P3-11: Edit notes (`editor`) and Play along (`playalong`) are reached only
// through the Songs panel, so the nav should keep Songs lit while either is
// open -- a learner never sees the nav go "nowhere" just because they opened
// a song to work on it. Both screens also gained a plain way back (Songs
// itself, or Play along's own "Back to songs" button) and land keyboard/
// screen-reader focus on their heading the moment they open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('Edit notes keeps Songs current in the nav', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");

  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"),
    'page',
    'Songs stays current while Edit notes is open',
  );
  const otherCurrent = await page.evaluate(
    "Array.from(document.querySelectorAll('#mainNav button[data-route]')).filter(b => b.dataset.route !== 'songs' && b.hasAttribute('aria-current')).length",
  );
  assert.equal(otherCurrent, 0, 'no other nav button claims to be current');
});

test('pressing Songs from Play along goes back to the list', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.waitFor("window.__coach.panelOpen() === 'playalong'");

  await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs');
});

test('Back to songs in Play along returns to the list', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.waitFor("window.__coach.panelOpen() === 'playalong'");

  await page.evaluate("document.getElementById('paBackToSongsBtn').click()");
  await page.waitFor("window.__coach.panelOpen() === 'songs'");

  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs');
});

test('opening Edit notes moves focus to its heading', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
  await page.waitFor("document.activeElement && document.activeElement.tagName === 'H2'");

  assert.equal(await page.evaluate('document.activeElement.tagName'), 'H2');
  assert.equal(await page.evaluate('document.activeElement.textContent'), 'Record a tune');
});

test('opening Play along moves focus to its heading', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('playalong')");
  await page.waitFor("window.__coach.panelOpen() === 'playalong'");
  await page.waitFor("document.activeElement && document.activeElement.tagName === 'H2'");

  assert.equal(await page.evaluate('document.activeElement.tagName'), 'H2');
  assert.equal(await page.evaluate('document.activeElement.textContent'), 'Play along');
});
