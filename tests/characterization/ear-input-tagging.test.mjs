// Ear-training answers record which input the learner used: 'screen-tap' for
// a click on a choice button, 'computer-key' for a number key. Real entry
// points only (a real button click, a real keydown); the debug hook is used
// to read the task and the logged events, and in the control case to prove
// the hook's direct answer() stays untagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function startEar(page) {
  await page.evaluate("window.__coach.setMod('ear')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  return page.evaluate('window.__coach.db().events.length');
}
async function newRows(page, before) {
  await page.waitFor(`window.__coach.db().events.length > ${before}`);
  return page.evaluate(`window.__coach.db().events.slice(${before})`);
}

test('clicking an ear choice button logs input: screen-tap', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const before = await startEar(page);
  const id = await page.evaluate('window.__coach.task().choices[0]');
  await page.evaluate(`document.getElementById('ch-' + ${JSON.stringify(id)}).click()`);
  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => assert.equal(r.input, 'screen-tap'));
  assert.deepEqual(page.exceptions, []);
});

test('pressing a number key on an ear question logs input: computer-key', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const before = await startEar(page);
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))");
  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => assert.equal(r.input, 'computer-key'));
  assert.deepEqual(page.exceptions, []);
});

test('control: the debug hook answer() with no input leaves the row untagged', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const before = await startEar(page);
  const id = await page.evaluate('window.__coach.task().choices[0]');
  await page.evaluate(`window.__coach.answer(${JSON.stringify(id)})`);
  const rows = await newRows(page, before);
  rows.forEach((r) => assert.equal(r.input, undefined));
});
