// "Play it on…" cards with a feasibility badge (plan D8). Drives the built
// page the same way tests/characterization/w-songs.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('every ready instrument gets a "Play it on…" card with a feasibility badge on the first step', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-instrument-card').length > 0");

  const cardCount = await page.evaluate("document.querySelectorAll('.panel-songs-instrument-card').length");
  // 28 ready instrument records as of this change (src/instruments/index.js; the drum kit is the 28th);
  // pinned here so a future added/removed instrument fails this test loudly
  // instead of silently drifting the card count.
  assert.equal(cardCount, 28, 'exactly one card per ready instrument');

  // Every card carries a non-empty badge with a known feasibility level.
  const badges = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-badge')).map(b => ({ level: b.getAttribute('data-feasibility'), text: b.textContent }))"
  );
  assert.equal(badges.length, cardCount);
  const knownLevels = ['as-written', 'transposed', 'partial', 'unplayable', 'empty'];
  badges.forEach((b) => {
    assert.ok(knownLevels.includes(b.level), 'unexpected feasibility level: ' + b.level);
    assert.ok(b.text.length > 0, 'badge has visible text');
  });

  assert.deepEqual(page.exceptions, []);
});

test('the badge for the current keyboard instrument on Hot Cross Buns reads "Fits as written"', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelectorAll('.panel-songs-instrument-card').length > 0");

  const kbdBadgeText = await page.evaluate(
    "(function () { const card = Array.from(document.querySelectorAll('.panel-songs-instrument-card')).find(c => c.textContent.includes('Keyboard')); return card ? card.querySelector('.panel-songs-badge').textContent : null; })()"
  );
  assert.equal(kbdBadgeText, 'Fits as written');
});

test('picking a card for a different instrument switches the lesson without closing the panel', async (t) => {
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
    "(function () { const card = Array.from(document.querySelectorAll('.panel-songs-instrument-card')).find(c => c.textContent.includes('Guitar')); card.querySelector('button').click(); })()"
  );
  await page.waitFor("window.__coach.db().panels.songs.instrumentId === 'gtr'");

  const saved = await page.evaluate('window.__coach.db().panels.songs');
  assert.equal(saved.instrumentId, 'gtr');
  // Still inside the songs panel, still showing a practice step, not booted
  // back to the main screen.
  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Listen'), 'a fresh lesson for the new instrument starts at its own listen step: ' + stepTitle);
  assert.deepEqual(page.exceptions, []);
});
