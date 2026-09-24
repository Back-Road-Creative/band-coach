// P2b-1: the collapsed "<Instrument> -- change instrument" summary line
// that used to live inside the picker itself is gone. The one way to
// change instrument is now the nav Instrument button: it names the current
// choice (or invites a first-time visitor to make one), and toggles #picker
// -- the chooser sheet -- open and shut. A first-time visitor (no saved mod
// at all) still meets the full instrument list straight away, exactly as
// before; a returning learner's sheet starts shut so the row does not fill
// the whole first screen on every visit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('collapse after choice: a fresh profile (no saved mod) shows the picker sheet open, nav button invites a first choice', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'a first-time visitor sees the instrument sheet open on first paint');
  assert.equal(await page.evaluate("document.getElementById('navInstrument').textContent"), 'Choose an instrument');
  assert.equal(await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')"), 'true');
});

test('collapse after choice: a saved mod starts the picker sheet shut, the nav button names it, and there is no second disclosure', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'a returning learner meets the sheet shut, not the whole list');
  const navLabel = await page.evaluate("document.getElementById('navInstrument').textContent");
  assert.match(navLabel, /guitar/i, 'the nav button names the saved instrument: ' + JSON.stringify(navLabel));
  assert.equal(await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')"), 'false');
  assert.equal(await page.evaluate("Boolean(document.getElementById('pickerCollapse'))"), false, 'the old #pickerCollapse wrapper is gone -- one disclosure, not two');
});

test('collapse after choice: pressing the nav Instrument button opens the sheet', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), false, 'the nav Instrument button reveals the sheet');
  assert.equal(await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')"), 'true');
});

test('collapse after choice: choosing a different instrument from the open sheet shuts it again and renames the nav button', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(htmlPath, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  await page.evaluate("document.querySelector('#picker button[data-mod=\"bass\"]').click()");
  await page.waitFor("document.querySelector('#picker button[data-mod=\"bass\"]').getAttribute('aria-pressed') === 'true'");

  assert.equal(await page.evaluate("document.getElementById('picker').hidden"), true, 'picking a new instrument shuts the sheet again');
  assert.equal(await page.evaluate("document.getElementById('navInstrument').getAttribute('aria-expanded')"), 'false');
  const navLabel = await page.evaluate("document.getElementById('navInstrument').textContent");
  assert.match(navLabel, /bass/i, 'the nav button now names the newly-chosen instrument: ' + JSON.stringify(navLabel));
});
