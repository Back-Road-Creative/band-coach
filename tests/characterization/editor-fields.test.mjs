// Edit notes: the Tempo / Beats-per-bar / beat-note fields show the song that
// was just opened (not blanks and a "/1"), an out-of-range tempo is held to
// the field's own 20-300 bpm bounds, and the score canvas keeps the shape it
// was drawn in instead of the page-wide 16:8.2 canvas box. Same real-click
// route as songs-edit-notes.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function openEditor(page, title) {
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(`Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === ${JSON.stringify(title)}).click()`);
  await page.waitFor("document.querySelectorAll('.panel-songs-song-actions button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-song-actions button')).find(b => b.textContent === 'Edit notes').click()");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
}

const fields = (page) => page.evaluate("({ bpm: document.getElementById('editorBpm').value, num: document.getElementById('editorMetreNum').value, den: document.getElementById('editorMetreDen').value })");
const type = (page, id, v) => page.evaluate(`(function(){ var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);

test('a freshly opened song fills Tempo and Beats/bar, and changing the beats keeps the beat note', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page, 'Hot Cross Buns');
  assert.deepEqual(await fields(page), { bpm: '100', num: '4', den: '4' });
  await type(page, 'editorMetreNum', '3');
  assert.deepEqual(await page.evaluate("window.__coach.editorSong().metre"), { num: 3, den: 4 });
});

test('a tempo outside 20-300 is held to the nearest bound and the field says so', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page, 'Hot Cross Buns');
  await type(page, 'editorBpm', '999');
  assert.equal(await page.evaluate("window.__coach.editorSong().bpm"), 300);
  assert.equal((await fields(page)).bpm, '300');
  await type(page, 'editorBpm', '5');
  assert.equal(await page.evaluate("window.__coach.editorSong().bpm"), 20);
  assert.equal((await fields(page)).bpm, '20');
  await type(page, 'editorBpm', '0');
  assert.equal(await page.evaluate("window.__coach.editorSong().bpm"), 20);
  await type(page, 'editorBpm', '90');
  assert.equal(await page.evaluate("window.__coach.editorSong().bpm"), 90);
  await type(page, 'editorBpm', '');
  assert.equal((await fields(page)).bpm, '90', 'a blanked field goes back to the song\'s real tempo');
});

test('the score canvas is shown in the shape it was drawn in', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page, 'Mary Had a Little Lamb');
  const m = await page.evaluate("(function(){ var c = document.getElementById('editorCanvas'), r = c.getBoundingClientRect(); return { aw: c.width, ah: c.height, cw: r.width, ch: r.height }; })()");
  assert.ok(Math.abs(m.cw / m.ch - m.aw / m.ah) < 0.05, 'displayed ' + m.cw + 'x' + m.ch + ' vs drawn ' + m.aw + 'x' + m.ah);
});

test('the theory staff canvas is shown in the shape it was drawn in', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker .picker-tools button[data-panel=\"theory\"]').click()");
  await page.evaluate("document.querySelector('.panel-theory [data-tab=\"explore\"]').click()");
  const m = await page.evaluate("(function(){ var c = document.getElementById('theoryExploreStaff'), r = c.getBoundingClientRect(); return { aw: c.width, ah: c.height, cw: r.width, ch: r.height }; })()");
  assert.ok(Math.abs(m.cw / m.ch - m.aw / m.ah) < 0.05, 'displayed ' + m.cw + 'x' + m.ch + ' vs drawn ' + m.aw + 'x' + m.ah);
});
