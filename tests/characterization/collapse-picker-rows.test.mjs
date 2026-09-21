// U6: the tools group and the #panelPicker "more ways to practise" row were
// two of the biggest remaining clusters of always-visible buttons (11
// together). Both now sit behind one native <details>/<summary> disclosure
// each -- shut on first paint, native keyboard support, no JS needed to
// toggle -- while the instrument row (#picker's top-level buttons) stays
// fully visible: picking an instrument is the one thing this page is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// Element.checkVisibility() is what actually tracks a closed <details>'
// hidden content in this Chromium build -- offsetParent stays non-null
// because the browser clips via its internal ::details-content wrapper
// (animatable height) rather than display:none on the child itself, so
// offsetParent alone is not a reliable signal here.
const isVisible = (sel) => `(function(){ var el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.checkVisibility(); })()`;

test('collapse rows: tools and panel buttons are hidden on first paint, instruments are not', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const kbdVisible = await page.evaluate(isVisible('#picker button[data-mod="kbd"]'));
  const tunerVisible = await page.evaluate(isVisible('#picker button[data-mod="tuner"]'));
  const songsVisible = await page.evaluate(isVisible('#panelPicker button[data-panel="songs"]'));

  assert.equal(kbdVisible, true, 'an instrument button (Keyboard) is visible on first paint');
  assert.equal(tunerVisible, false, 'the Tuner tool button is hidden inside a shut disclosure on first paint');
  assert.equal(songsVisible, false, 'the Songs panel button is hidden inside a shut disclosure on first paint');
});

test('collapse rows: exactly one control opens the tools group and one opens the panel row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const toolsSummaryText = await page.evaluate(
    "(document.querySelector('#picker .picker-tools summary') || {}).textContent || ''",
  );
  const panelSummaryText = await page.evaluate(
    "(document.querySelector('summary[data-panel-disclosure], .panel-picker-disclosure summary') || {}).textContent || ''",
  );

  assert.match(toolsSummaryText, /tuner|drill|tool/i, 'the shut tools control names what is inside it, not just "Tools": ' + JSON.stringify(toolsSummaryText));
  assert.match(panelSummaryText, /practise|practice/i, 'the shut panel-row control keeps a self-describing label: ' + JSON.stringify(panelSummaryText));
});

test('collapse rows: opening the tools disclosure reveals every tool button', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#picker .picker-tools').open = true");
  const tunerVisible = await page.evaluate(isVisible('#picker button[data-mod="tuner"]'));
  const earVisible = await page.evaluate(isVisible('#picker button[data-mod="ear"]'));
  const rhyVisible = await page.evaluate(isVisible('#picker button[data-mod="rhy"]'));
  const captureVisible = await page.evaluate(isVisible('#picker button[data-mod="capture"]'));

  assert.equal(tunerVisible, true);
  assert.equal(earVisible, true);
  assert.equal(rhyVisible, true);
  assert.equal(captureVisible, true);
});

test('collapse rows: opening the panel disclosure reveals every panel button', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const details = await page.evaluate("document.getElementById('panelPicker').closest('details') ? true : false");
  assert.equal(details, true, '#panelPicker sits inside a <details> disclosure');
  await page.evaluate("document.getElementById('panelPicker').closest('details').open = true");
  const songsVisible = await page.evaluate(isVisible('#panelPicker button[data-panel="songs"]'));
  assert.equal(songsVisible, true);
});

test('collapse rows: selecting a grouped tool forces its group open', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const shutBefore = await page.evaluate("document.querySelector('#picker .picker-tools').open");
  assert.equal(shutBefore, false, 'sanity: tools group starts shut on a fresh profile');

  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"tuner\"]').getAttribute('aria-pressed') === 'true'");

  const openAfter = await page.evaluate("document.querySelector('#picker .picker-tools').open");
  assert.equal(openAfter, true, 'clicking a tool leaves its own group open so the pressed button stays visible');
});

test('collapse rows: opening a practice panel forces the panel-row group open, without the row being opened first', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const shutBefore = await page.evaluate("document.getElementById('panelPicker').closest('details').open");
  assert.equal(shutBefore, false, 'sanity: the panel row starts shut on a fresh profile');

  // A closed <details>' contents are unrendered but still real DOM nodes,
  // so the real button's own click handler fires exactly as a sighted user
  // clicking after opening the disclosure would trigger -- no debug hook
  // needed to prove the group opens itself.
  await page.evaluate("document.querySelector('#panelPicker button[data-panel=\"songs\"]').click()");
  await page.waitFor("document.querySelector('#panelPicker button[data-panel=\"songs\"]').getAttribute('aria-pressed') === 'true'");

  const openAfter = await page.evaluate("document.getElementById('panelPicker').closest('details').open");
  assert.equal(openAfter, true, 'opening a panel leaves the panel row group open so the pressed button stays visible');
});
