// P2b-3: the last of three stacked units that gives every registered panel a
// plain, always-reachable home and removes the two hidden-by-default
// disclosures (#panelPickerDisclosure "More ways to practise", the instrument
// sheet's <details id="pickerTools"> "More tools: ..."). Songs, History,
// Learn this, Record a tune and Play Along got their homes in P2a/P2b-1/
// P2b-2; this unit gives Ear training, How to play it and Music theory a
// home in the instrument sheet's plain Tools group, and Learn this/Record a
// tune/Play Along a home in a new "Add a song" row at the top of the Songs
// panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('panel homes: neither disclosure exists any more', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('panelPickerDisclosure')"), null, 'the old #panelPickerDisclosure is gone');
  assert.equal(await page.evaluate("document.getElementById('panelPicker')"), null, 'the old #panelPicker row is gone');
  assert.equal(await page.evaluate("!!document.querySelector('details.picker-tools')"), false, 'the tools group is a plain group, not a <details>');
});

test('panel homes: opening the instrument sheet shows every tool, including the three panel tools, with no extra click', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");

  const isVisible = (sel) => `(function(){ var el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.checkVisibility(); })()`;
  assert.equal(await page.evaluate(isVisible('#picker button[data-mod="tuner"]')), true, 'Tuner shows with no extra click');
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="fingerings"]')), true, '"How to play it" shows with no extra click');
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="ear"]')), true, '"Ear training" shows with no extra click');
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="theory"]')), true, '"Music theory" shows with no extra click');
});

test('panel homes: clicking a panel tool button opens that panel and closes the sheet', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");

  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'theory', 'Music theory is reachable from the open instrument sheet');
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'the sheet shuts, the same as picking an instrument does');
});

// P3-4: the Add-a-song row's three panel-opening buttons became one "Add a
// song" button that reveals a Record/Open-file section inside Songs itself
// (tests/characterization/songs-add-a-song.test.mjs covers that section in
// full) -- renamed from "...offers Record a tune, Learn this and Play Along"
// and the final click now checks the row no longer navigates away.
test('panel homes: the Songs panel\'s first row offers Add a song', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");

  const labels = await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).map(b => b.textContent.trim())",
  );
  assert.deepEqual(labels, ['Add a song']);

  const isFirstChild = await page.evaluate("document.querySelector('.add-song-row').previousElementSibling === null");
  assert.equal(isFirstChild, true, 'the Add-a-song row is the first thing inside the Songs panel');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).find(b => b.textContent.trim() === 'Add a song').click()",
  );
  assert.equal(
    await page.evaluate("!!document.querySelector('.panel-songs-record-btn') && !!document.getElementById('songsFileInput')"),
    true,
    'pressing Add a song reveals the Record and Open file section, in place',
  );
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'songs', 'Songs stays open -- the row no longer opens another panel');
  assert.equal(
    await page.evaluate("document.querySelector('#mainNav button[data-route=\"songs\"]').getAttribute('aria-current')"),
    'page',
    'Songs stays the current nav destination',
  );
});

test('panel homes: axe finds no violations with the instrument sheet open', async (t) => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const axeSource = readFileSync(
    fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url)),
    'utf8',
  );
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate(axeSource);
  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  const results = await page.evaluate(
    "axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })",
  );
  assert.equal(results.violations.length, 0, JSON.stringify(results.violations.map((v) => v.id)));
});
