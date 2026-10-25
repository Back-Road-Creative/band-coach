// Metronome tool: opens from the picker's tools group, tempo is clamped,
// Start/Stop drive a look-ahead click on the shared AudioContext, and the
// saved tempo/beats survive a reopen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const init = (locale) => `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'gtr'${locale ? `, locale: '${locale}'` : ''} } }));`;
const root = "document.querySelector('.panel-metronome')";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openFromPicker(page) {
  await page.evaluate("document.getElementById('navInstrument').click()");
  await page.waitFor("document.getElementById('picker').hidden === false");
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"metronome\"]').click()");
  await page.waitFor(`!!${root}`);
}
const setBpm = (page, v) => page.evaluate(`(function(){ var i = document.querySelector('.panel-metronome input[type=number]'); i.value = '${v}'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return i.value; })()`);

test('metronome: tempo clamps, start/stop drive the beat count, tempo is kept on reopen', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: init() });
  t.after(() => page.close());
  await openFromPicker(page);
  assert.equal(await page.evaluate('window.__coach.panelOpen()'), 'metronome');
  assert.equal(await page.evaluate(`${root}.querySelector('input[type=number]').value`), '80');
  assert.equal(await page.evaluate(`${root}.querySelector('select').value`), '4');
  assert.equal(await setBpm(page, 300), '240');
  assert.equal(await page.evaluate(`${root}.querySelector('input[type=range]').value`), '240');

  await setBpm(page, 240);
  const btn = `${root}.querySelector('button.metronome-toggle')`;
  assert.equal(await page.evaluate(`${btn}.getAttribute('aria-pressed')`), 'false');
  await page.evaluate(`${btn}.click()`);
  assert.equal(await page.evaluate(`${btn}.getAttribute('aria-pressed')`), 'true');
  await page.waitFor(`Number(${root}.dataset.beat) >= 3`, 5000);
  assert.equal(await page.evaluate(`${root}.dataset.running`), 'true');

  await page.evaluate(`${btn}.click()`);
  assert.equal(await page.evaluate(`${btn}.getAttribute('aria-pressed')`), 'false');
  assert.equal(await page.evaluate(`${root}.dataset.running`), 'false');
  const n1 = await page.evaluate(`Number(${root}.dataset.beat)`);
  await sleep(800);
  assert.equal(await page.evaluate(`Number(${root}.dataset.beat)`), n1, 'no beats after Stop');

  await page.evaluate("window.__coach.closePanel()");
  await page.evaluate("window.__coach.openPanel('metronome')");
  await page.waitFor(`!!${root}`);
  assert.equal(await page.evaluate(`${root}.querySelector('input[type=number]').value`), '240');
  assert.deepEqual(page.exceptions, []);
});

test('metronome: closing the panel stops the clock', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: init() });
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('metronome')");
  await page.waitFor(`!!${root}`);
  await page.evaluate(`${root}.querySelector('button.metronome-toggle').click()`);
  await page.evaluate("window.__coach.closePanel()");
  await sleep(500);
  assert.equal(await page.evaluate(`!!${root}`), false);
  assert.deepEqual(page.exceptions, []);
});

test('metronome: Spanish locale shows Spanish labels', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: init('es') });
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('metronome')");
  await page.waitFor(`!!${root}`);
  assert.equal(await page.evaluate(`${root}.querySelector('h2').textContent`), 'Metrónomo');
  assert.match(await page.evaluate(`${root}.querySelector('button.metronome-toggle').textContent`), /Iniciar/);
  assert.deepEqual(page.exceptions, []);
});
