// U5: on a real phone (390x844) the instrument row alone -- 10 top-level
// buttons plus the tools/panel disclosures earlier units already collapsed --
// filled the entire first screen, so the Start button was nowhere near the
// fold. A learner who already picked an instrument (a saved mod in
// DB.prefs.mod) does not need to see all ten again every visit: once chosen,
// the row collapses to just that instrument plus one explicit control to
// reopen the full list, reusing the exact <details>/<summary> idiom
// .picker-tools already established. A first-time visitor (no saved mod at
// all) has nothing to collapse -- picking an instrument is still the one
// thing this page is for -- so they see the full row, exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Element.checkVisibility() is what actually tracks a closed <details>'
// hidden content in this Chromium build -- offsetParent stays non-null
// because the browser clips via its internal ::details-content wrapper
// (animatable height) rather than display:none on the child itself.
const isVisible = (sel) => `(function(){ var el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.checkVisibility(); })()`;

test('collapse after choice: a fresh profile (no saved mod) shows the full instrument list, uncollapsed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const hasCollapse = await page.evaluate("Boolean(document.getElementById('pickerCollapse'))");
  assert.equal(hasCollapse, false, 'a first-time visitor has nothing to collapse: no #pickerCollapse wrapper at all');

  const gtrVisible = await page.evaluate(isVisible('#picker button[data-mod="gtr"]'));
  const kbdVisible = await page.evaluate(isVisible('#picker button[data-mod="kbd"]'));
  assert.equal(gtrVisible, true, 'Guitar is directly visible on first paint for a first-time visitor');
  assert.equal(kbdVisible, true, 'Keyboard (the default mod) is directly visible too');
});

test('collapse after choice: a saved mod shows only that instrument on first paint, the rest are genuinely not visible', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  const collapseShut = await page.evaluate("document.getElementById('pickerCollapse').open");
  assert.equal(collapseShut, false, 'the picker collapse starts shut for a returning visitor');

  const gtrVisible = await page.evaluate(isVisible('#picker button[data-mod="gtr"]'));
  const kbdVisible = await page.evaluate(isVisible('#picker button[data-mod="kbd"]'));
  const bassVisible = await page.evaluate(isVisible('#picker button[data-mod="bass"]'));
  assert.equal(kbdVisible, false, 'Keyboard is not visible -- the picker is collapsed to the saved choice');
  assert.equal(bassVisible, false, 'Bass is not visible either');
  // The chosen instrument's own button lives inside the shut collapse too --
  // only the summary line (naming it) stays visible, matching .picker-tools'
  // own established idiom of a summary that is visible while its group is shut.
  assert.equal(gtrVisible, false, 'the chosen instrument\'s own button is inside the shut disclosure, same as any other');

  const summaryText = await page.evaluate("document.querySelector('#pickerCollapse > summary').textContent");
  assert.match(summaryText, /guitar/i, 'the collapsed summary names the chosen instrument: ' + JSON.stringify(summaryText));
  assert.match(summaryText, /change instrument/i, 'the collapsed summary carries an obvious, plain-language way back to the full list: ' + JSON.stringify(summaryText));
});

test('collapse after choice: the reopen control restores the full list', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#pickerCollapse > summary').click()");
  await page.waitFor("document.getElementById('pickerCollapse').open === true");

  const kbdVisible = await page.evaluate(isVisible('#picker button[data-mod="kbd"]'));
  const bassVisible = await page.evaluate(isVisible('#picker button[data-mod="bass"]'));
  const gtrVisible = await page.evaluate(isVisible('#picker button[data-mod="gtr"]'));
  assert.equal(kbdVisible, true, 'reopening the picker reveals Keyboard again');
  assert.equal(bassVisible, true, 'reopening the picker reveals Bass again');
  assert.equal(gtrVisible, true, 'the previously-chosen instrument (Guitar) is visible too, still pressed');
});

test('collapse after choice: choosing a different instrument from the reopened list collapses back to the new choice', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#pickerCollapse > summary').click()");
  await page.waitFor("document.getElementById('pickerCollapse').open === true");
  await page.evaluate("document.querySelector('#picker button[data-mod=\"bass\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"bass\"]').getAttribute('aria-pressed') === 'true'");

  const collapseShut = await page.evaluate("document.getElementById('pickerCollapse').open");
  assert.equal(collapseShut, false, 'picking a new instrument re-collapses the list');

  const summaryText = await page.evaluate("document.querySelector('#pickerCollapse > summary').textContent");
  assert.match(summaryText, /bass/i, 'the collapsed summary now names the newly-chosen instrument: ' + JSON.stringify(summaryText));

  const gtrVisible = await page.evaluate(isVisible('#picker button[data-mod="gtr"]'));
  assert.equal(gtrVisible, false, 'the previously-chosen instrument is hidden again once a new one is picked');
});
