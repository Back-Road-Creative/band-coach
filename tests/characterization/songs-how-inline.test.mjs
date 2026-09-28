// C1b: "How to play this" — a button under the current step of a Songs
// Learn/Rehearse lesson that expands the SAME Fingerings-panel diagram and
// description for the lesson's instrument and the step's current note, no
// second selection required. Hidden in Check (the no-help attempt), same
// as the notation/fingering line it sits beside (songs.js's
// `practice.mode !== 'check'` block).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { en } from '../../src/core/i18n.js';

const htmlPath = HTML_PATH;

test("How to play this shows the Fingerings panel's diagram for the step's note, closes on Escape, and is absent in Check", async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // 1. Get the panel's own reference for guitar, note E4 (midi 64) --
  // Hot Cross Buns' first note, inside gtr's 40-76 range.
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("window.__coach.openPanel('fingerings')");
  await page.evaluate(`(function () {
    const sel = document.getElementById('fingInstrument');
    sel.value = 'gtr'; sel.dispatchEvent(new Event('change'));
  })()`);
  await page.waitFor("document.querySelector('.fing-note-btn[data-midi=\"64\"]')");
  await page.evaluate("document.querySelector('.fing-note-btn[data-midi=\"64\"]').click()");
  const expectedDesc = await page.evaluate("document.getElementById('fingDesc').textContent");
  const expectedHits = await page.evaluate(
    "document.querySelectorAll('.panel-fingerings .fing-diagram-host .fing-hit').length"
  );
  assert.ok(expectedHits > 0, 'guitar E4 should have at least one fing-hit in the panel diagram');
  await page.evaluate('window.__coach.closePanel()');

  // 2. Open Hot Cross Buns' Learn lesson.
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  // 3. RED at base: no such toggle exists yet.
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-practice .how-inline-toggle')).some(b => b.textContent === ${JSON.stringify(en['howInline.button'])})`
  );
  const toggleSel = `Array.from(document.querySelectorAll('.how-inline-toggle')).find(b => b.textContent === ${JSON.stringify(en['howInline.button'])})`;

  assert.equal(await page.evaluate(`(${toggleSel}).getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`(${toggleSel}).nextElementSibling ? (${toggleSel}).parentElement.querySelector('.how-inline-body').hidden : true`), true);

  await page.evaluate(`(${toggleSel}).click()`);

  assert.equal(await page.evaluate(`(${toggleSel}).getAttribute('aria-expanded')`), 'true');
  assert.equal(await page.evaluate("document.querySelector('.how-inline-body').hidden"), false);
  assert.equal(await page.evaluate("document.querySelector('.how-inline-desc').textContent"), expectedDesc);
  const inlineHits = await page.evaluate("document.querySelectorAll('.how-inline-body .fing-hit').length");
  assert.equal(inlineHits, expectedHits);
  assert.match(
    await page.evaluate("document.querySelector('.how-inline-badge').textContent"),
    /Not yet checked by a player/
  );

  // 4. Escape collapses it, focus returns to the button, and Songs stays open.
  await page.evaluate(`(${toggleSel}).focus()`);
  await page.press('Escape');

  assert.equal(await page.evaluate("document.querySelector('.how-inline-body').hidden"), true);
  assert.equal(await page.evaluate(`(${toggleSel}).getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate("document.activeElement.classList.contains('how-inline-toggle')"), true);
  assert.equal(await page.evaluate("window.__coach.panelOpen()"), 'songs');

  // 5. Absent in Check.
  await page.evaluate("document.querySelector('.panel-songs-mode button[data-mode=\"check\"]').click()");
  await page.waitFor("document.querySelector('.panel-songs-mode button[data-mode=\"check\"][aria-pressed=\"true\"]')");
  assert.equal(await page.evaluate("!!document.querySelector('.how-inline-toggle')"), false);

  assert.deepEqual(page.exceptions, []);
});
