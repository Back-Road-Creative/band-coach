// tests/helpers/file-chooser.mjs picks a file the way a person does: a real
// click on the visible control, then the browser's own file chooser, answered
// through the DevTools protocol. This pins that one pick fires the input's
// input and change events once each, both trusted; that picking the same file
// again fires nothing, as in a real browser; and that it refuses a control a
// person could not click, a click that opens no chooser and a missing file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/acceptance/file-chooser-fixture.html', import.meta.url));

function files(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bc-chooser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.txt'), 'a');
  writeFileSync(join(dir, 'b.txt'), 'bb');
  return { a: join(dir, 'a.txt'), b: join(dir, 'b.txt'), missing: join(dir, 'missing.txt') };
}

async function open(t) {
  const page = await launchPage(FIXTURE, { acceptance: true });
  t.after(() => page.close());
  return page;
}

const picks = (page) => page.evaluate('window.__picks');

test('chooseFile: through the label, one pick is one trusted input and change, and the same file again is nothing', async (t) => {
  const f = files(t);
  const page = await open(t);
  await chooseFile(page, '#pick', f.a);
  await chooseFile(page, '#pick', f.a);
  await chooseFile(page, '#pick', f.b);
  // Events from the repeat pick would sit between the two pairs, so waiting
  // for the last one is enough: no sleep stands in for "nothing happened".
  await page.waitFor("window.__picks.includes('change:b.txt')");
  assert.deepEqual(await picks(page), ['input:a.txt', 'change:a.txt', 'input:b.txt', 'change:b.txt']);
  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions');
});

test('chooseFile: a button whose click opens the chooser from script works the same way', async (t) => {
  const f = files(t);
  const page = await open(t);
  await chooseFile(page, '#open', f.b);
  await page.waitFor("window.__picks.includes('change:b.txt')");
  assert.deepEqual(await picks(page), ['input:b.txt', 'change:b.txt']);
  const picked = await page.evaluate("(() => { const f = document.getElementById('file').files; return { n: f.length, name: f[0].name, size: f[0].size }; })()");
  assert.deepEqual(picked, { n: 1, name: 'b.txt', size: 2 }, 'the input holds the real file');
});

test('chooseFile: a click that opens no chooser fails with a plain reason, and the page still takes a real pick', { timeout: 120000 }, async (t) => {
  const f = files(t);
  const page = await open(t);
  await assert.rejects(() => chooseFile(page, '#inert', f.a), /chooseFile: clicking #inert opened no file chooser within \d+ ms/);
  assert.equal(await page.evaluate('window.__clicks'), 1, 'the button was really clicked');
  assert.deepEqual(await picks(page), []);
  await chooseFile(page, '#pick', f.a);
  await page.waitFor("window.__picks.includes('change:a.txt')");
  assert.deepEqual(await picks(page), ['input:a.txt', 'change:a.txt']);
});

test('chooseFile: refuses the hidden input itself, which a person cannot click', async (t) => {
  const f = files(t);
  const page = await open(t);
  await assert.rejects(() => chooseFile(page, '#file', f.a), /cannot click: #file is hidden/);
  assert.equal(await page.evaluate('window.__clicks'), 0);
  assert.deepEqual(await picks(page), []);
  assert.equal(await page.evaluate("document.getElementById('file').files.length"), 0, 'nothing was put in the input');
});

test('chooseFile: a file that is not there fails before anything is clicked', async (t) => {
  const f = files(t);
  const page = await open(t);
  await assert.rejects(() => chooseFile(page, '#pick', f.missing), /chooseFile: no file at .*missing\.txt/);
  assert.equal(await page.evaluate('window.__clicks'), 0, 'nothing was clicked');
  assert.deepEqual(await picks(page), []);
});
