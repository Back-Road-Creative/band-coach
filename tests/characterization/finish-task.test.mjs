// Pins what finishing a drill task does, through the real optCustom checkbox
// and the real play button: every judged element logs one learning-event row
// (warm-up source for a captured-melody task), the task is marked done, and
// a captured-melody task's onDone hook then advances the four-note chunk, so
// the next task is the remaining note. This held while finishTask was wrapped
// in a second assignment (const _finish = finishTask; finishTask = ...); the
// single definition must keep it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('finishing a clean captured-melody chunk logs the rows, marks done and advances to the next chunk', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate('window.__coach.db().custom = [60, 62, 64, 65, 67]');
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("(function () { const cb = document.getElementById('optCustom'); cb.checked = true; cb.dispatchEvent(new Event('change')); })()");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const before = await page.evaluate('window.__coach.db().events.length');

  const first = await page.evaluate('window.__coach.task().els.map(e => e.info.midi)');
  assert.deepEqual(first, [60, 62, 64, 65]);
  for (let i = 0; i < 4; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
  }
  await page.waitFor('window.__coach.db().events.length >= ' + (before + 4), 5000);
  const rows = await page.evaluate(`window.__coach.db().events.slice(${before})`);
  assert.equal(rows.length, 4, 'one learning-event row per judged element');
  rows.forEach((r) => assert.equal(r.source, 'warmup'));

  // onDone ran: the chunk advanced, so the next task is the one remaining note.
  await page.waitFor('window.__coach.task() && !window.__coach.task().done && window.__coach.task().els.length === 1', 5000);
  assert.deepEqual(await page.evaluate('window.__coach.task().els.map(e => e.info.midi)'), [67]);
  assert.deepEqual(page.exceptions, []);
});
