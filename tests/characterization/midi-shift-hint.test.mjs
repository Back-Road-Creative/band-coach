// F13: four wrong MIDI notes in a row, all one octave above the target, read
// as a keyboard shifted up an octave, and the feedback says to check the
// keyboard's octave or transpose buttons. One such miss keeps the usual hint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function start(t) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  return page;
}
const missUp = (page) => page.evaluate("(() => { const m = window.__coach.cur().info.midi + 12; window.__coach.note(m, true, 'midi'); return document.getElementById('feedback').textContent; })()");

test('four misses an octave up name the shifted keyboard', async (t) => {
  const page = await start(t);
  let fb = '';
  for (let k = 0; k < 4; k++) fb = await missUp(page);
  assert.match(fb, /an octave too high/, fb);
  assert.match(fb, /octave or transpose/, fb);
  assert.deepEqual(page.exceptions, []);
});

test('one miss an octave up keeps the usual octave hint', async (t) => {
  const page = await start(t);
  const fb = await missUp(page);
  assert.match(fb, /Right note, wrong octave: go one octave down\./, fb);
  assert.doesNotMatch(fb, /too high/, fb);
});

test('the same notes from the computer keyboard never read as a shifted MIDI keyboard', async (t) => {
  const page = await start(t);
  let fb = '';
  for (let k = 0; k < 4; k++) fb = await page.evaluate("(() => { const m = window.__coach.cur().info.midi + 12; window.__coach.note(m, true, 'computer-key'); return document.getElementById('feedback').textContent; })()");
  assert.doesNotMatch(fb, /too high/, fb);
});
