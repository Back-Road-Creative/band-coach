// New behaviour (unit 7.7 items 1 and 2): the exercise canvas gets a text
// mirror in a visually-hidden element it points at with aria-describedby,
// kept current as the task changes; #prompt is a polite live region.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { describeTask } from '../../src/ui/describe.js';

const htmlPath = HTML_PATH;

test('the canvas has an accessible role, label and description target', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('cv').getAttribute('role')"), 'img');
  assert.ok(await page.evaluate("document.getElementById('cv').getAttribute('aria-label')"));
  const describedBy = await page.evaluate("document.getElementById('cv').getAttribute('aria-describedby')");
  assert.equal(describedBy, 'cvDesc');
  assert.ok(await page.evaluate("document.getElementById('cvDesc')"), 'the description target element exists');
});

test('#prompt is a polite live region', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  assert.equal(await page.evaluate("document.getElementById('prompt').getAttribute('aria-live')"), 'polite');
});

test('the hidden description text matches describeTask() for the live task, and never leaks an unrevealed note name', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const task = await page.evaluate('window.__coach.task()');
  const cur = await page.evaluate('window.__coach.cur()');
  const revealed = !!(cur.reveal || cur.failed);
  const expected = describeTask(task, { revealed });
  const actual = await page.evaluate("document.getElementById('cvDesc').textContent");
  assert.equal(actual, expected);

  // A freshly-reset item is revealed on its first two exposures; force an
  // unrevealed state the way the pinned reveal/failed flags already gate the
  // canvas dot, then rebuild the description the same way app.js does.
  await page.evaluate("window.__coach.cur().reveal = false");
  await page.evaluate("window.__coach.cur().failed = false");
  const task2 = await page.evaluate('window.__coach.task()');
  const sentence = describeTask(task2, { revealed: false });
  if (task2.els[task2.idx] && task2.els[task2.idx].info && task2.els[task2.idx].info.label) {
    assert.ok(!sentence.includes(task2.els[task2.idx].info.label), 'an unrevealed note name must not appear in the mirror');
  }
});

test('failing an element updates the description to the revealed sentence', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')"); // string items hide string/fret until revealed or failed
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  await page.evaluate(`window.__coach.note(${info.midi + 1}, false)`); // wrong note -> failEl
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  const task = await page.evaluate('window.__coach.task()');
  const expected = describeTask(task, { revealed: true });
  const actual = await page.evaluate("document.getElementById('cvDesc').textContent");
  assert.equal(actual, expected);
  assert.ok(actual.includes(String(info.string)), 'a failed element reveals which string it lives on');
});
