// FE-9: each instrument button in the instrument sheet carries a small chip
// saying how the app checks that instrument (src/instruments/capability.js
// capabilityChipKeys), in the learner's language, never a maturity tier name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const chip = id => `(function(){ var c = document.querySelector('#picker button[data-mod="${id}"] .cap-chip'); return c ? c.textContent : null; })()`;

test('instrument buttons show a capability chip; tools do not', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr' } }));";
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  assert.equal(await page.evaluate(chip('kbd')), 'Checks exact notes');
  assert.equal(await page.evaluate(chip('gtr')), 'Hears one note at a time');
  assert.equal(await page.evaluate(chip('voice')), 'Hears one note at a time · No fingering chart');
  assert.equal(await page.evaluate(chip('clarinet-bb')), 'Hears one note at a time · Chart not yet checked');
  assert.equal(await page.evaluate("document.querySelectorAll('#picker .picker-tools .cap-chip').length"), 0, 'tools carry no chip');
  const text = await page.evaluate("document.getElementById('picker').textContent");
  assert.doesNotMatch(text, /candidate|unvalidated|untested/i);
  assert.deepEqual(page.exceptions, []);
});

test('the chip follows the locale', async (t) => {
  const initScript = "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr', locale: 'es' } }));";
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());

  await page.evaluate("document.getElementById('navInstrument').click()");
  assert.equal(await page.evaluate(chip('gtr')), 'Escucha una nota a la vez');
  assert.deepEqual(page.exceptions, []);
});
