// P2b-3: the tools group and the #panelPicker "more ways to practise" row
// used to sit behind two separate <details>/<summary> disclosures -- shut on
// first paint, needing an extra click each before their contents were even
// reachable. Both disclosures are gone now: the tools group is a plain,
// always-visible group inside the instrument sheet (Tuner, Capture a melody,
// Interval drill, Rhythm, Ear training, How to play it, Music theory all
// show with no extra click once the sheet itself is open), and the panel row
// no longer exists at all -- Songs/History live on the nav bar, Learn this/
// Record a tune/Play Along live in the Songs panel's own Add-a-song row.
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

test('collapse rows: the instrument sheet itself is hidden on first paint, but nothing inside it is behind a second disclosure', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  const sheetHiddenBefore = await page.evaluate("document.getElementById('picker').hidden");
  assert.equal(sheetHiddenBefore, true, 'the instrument sheet itself starts closed on a fresh profile with a saved instrument');

  // The variant-toggle groups (e.g. ukulele tuning, ukulele family) keep
  // their own small <details> by design (see src/styles.css's
  // .picker-variant-group comment) -- only the tools group's disclosure is
  // gone.
  assert.equal(await page.evaluate("!!document.querySelector('#picker .picker-tools[id=\"pickerTools\"]')"), true, 'the tools group is still there, just no longer a <details>');
  assert.equal(await page.evaluate("document.querySelector('#picker .picker-tools').tagName"), 'DIV', 'the tools group is a plain <div>, not a <details>');
});

test('collapse rows: no "more ways to practise" control exists anywhere', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('panelPickerDisclosure')"), null);
  assert.equal(await page.evaluate("document.getElementById('panelPicker')"), null);
  assert.equal(await page.evaluate("!!document.querySelector('.panel-picker-disclosure')"), false);
});

test('collapse rows: opening the instrument sheet reveals every tool, including the three panel tools, with no extra click', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");

  assert.equal(await page.evaluate(isVisible('#picker button[data-mod="tuner"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker button[data-mod="capture"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker button[data-mod="ear"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker button[data-mod="rhy"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="ear"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="fingerings"]')), true);
  assert.equal(await page.evaluate(isVisible('#picker .picker-tools button[data-panel="theory"]')), true);
});

test('collapse rows: Songs and History are reachable from the nav bar, without opening the instrument sheet at all', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  assert.equal(await page.evaluate("!!document.querySelector('#mainNav button[data-route=\"songs\"]')"), true);
  assert.equal(await page.evaluate("!!document.querySelector('#mainNav button[data-route=\"progress\"]')"), true);
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'reaching Songs/History never needed the instrument sheet open');
});

test('collapse rows: selecting a tool in the sheet marks it pressed without needing to reopen anything', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"tuner\"]').getAttribute('aria-pressed') === 'true'");

  assert.equal(await page.evaluate("document.querySelector('#picker button[data-mod=\"tuner\"]').getAttribute('aria-pressed')"), 'true');
});

test('collapse rows: Learn this, Record a tune and Play Along are reachable from the Songs panel\'s Add-a-song row, not from the instrument sheet', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelector('.add-song-row')");

  const labels = await page.evaluate(
    "Array.from(document.querySelectorAll('.add-song-row button')).map(b => b.textContent.trim())",
  );
  assert.deepEqual(labels, ['Record a tune', 'Learn this', 'Play Along']);
  assert.equal(await page.evaluate("!!document.querySelector('#picker button[data-panel=\"learn\"]')"), false, 'Learn this has no button inside the instrument sheet');
});
