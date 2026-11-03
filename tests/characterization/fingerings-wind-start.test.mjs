// "How to play it" opened from the Wind and brass module starts on a wind
// chart for the chosen transposition group, never on Keyboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function openHow(page, mod, group) {
  await page.evaluate(`window.__coach.setMod('${mod}')`); // the picker's own handler calls the same setMod
  if (group) {
    await page.waitFor("document.getElementById('optWind')");
    await page.evaluate(`(function () { const s = document.getElementById('optWind'); s.value = '${group}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  await page.evaluate("document.querySelector('button[data-panel=\"fingerings\"]').click()");
  await page.waitFor("document.getElementById('fingInstrument')");
}
const sel = "document.getElementById('fingInstrument').value";
const note = "(document.querySelector('.fing-wind-note') || {}).textContent || ''";

test('wind module, B flat group: opens on the trumpet with a choose-yours line, no keyboard', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openHow(page, 'wind', 'bb');
  assert.equal(await page.evaluate(sel), 'trumpet-bb');
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-keyboard').length"), 0);
  assert.match(await page.evaluate(note), /several instruments/);
});

test('wind module, bass clef group: opens on the trombone, one instrument so no choose line', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openHow(page, 'wind', 'bc');
  assert.equal(await page.evaluate(sel), 'trombone');
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-keyboard').length"), 0);
  assert.equal(await page.evaluate(note), '');
});

test('wind module, baritone sax group: says there is no chart yet and shows no keyboard', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openHow(page, 'wind', 'ebb');
  assert.match(await page.evaluate(note), /no chart yet/);
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-keyboard').length"), 0);
  // Picking a real chart takes the "no chart" line away, and nothing threw on the way.
  await page.evaluate("(function () { const s = document.getElementById('fingInstrument'); s.value = 'sax-alto-eb'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal(await page.evaluate("document.querySelector('.fing-wind-note').hidden"), true);
  assert.equal(await page.evaluate(sel), 'sax-alto-eb');
  assert.deepEqual(page.exceptions, []);
});

test('controls: keyboard still opens on Keyboard, guitar on its fretboard', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openHow(page, 'kbd');
  assert.equal(await page.evaluate(sel), 'kbd');
  assert.equal(await page.evaluate("document.querySelectorAll('.fing-keyboard').length"), 1);
  assert.equal(await page.evaluate(note), '');
  await page.evaluate("window.__coach.closePanel && window.__coach.closePanel()");
  const p2 = await launchPage(HTML_PATH);
  t.after(() => p2.close());
  await openHow(p2, 'gtr');
  assert.equal(await p2.evaluate(sel), 'gtr');
  assert.ok(await p2.evaluate("document.querySelectorAll('.fing-fretboard .fing-string').length") >= 6);
});
