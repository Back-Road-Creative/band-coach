// tests/helpers/file-chooser.mjs picks a file the way a person does: a real
// click on the visible control, then the browser's own file chooser, answered
// through the DevTools protocol. This pins that one pick fires the input's
// input and change events once each, both trusted; that picking the same file
// again fires nothing, as in a real browser; and that it refuses a control a
// person could not click, a click that opens no chooser, a missing file or a
// directory, and an unknown dialog option. It also pins that a confirm() the
// page's change handler raises is answered, or fails fast, and that interception
// is off again once a pick is over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage, WAIT_FLOOR_MS, effectiveWaitMs } from '../helpers/browser.mjs';
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
const restores = (page) => page.evaluate('window.__restores');
const CONFIRM = 'Replace your progress with this backup?';

// A pick whose dialog is not answered never returns; this turns that hang into a
// named failure instead of a test-runner timeout.
function within(promise) {
  let timer;
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('chooseFile did not return: the dialog was not answered')), WAIT_FLOOR_MS); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

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

test('chooseFile: a click that opens no chooser fails with a plain reason, and the page still takes a real pick', { timeout: effectiveWaitMs() + 60000 }, async (t) => {
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
  await assert.rejects(() => chooseFile(page, '#pick', dirname(f.a)), /chooseFile: no file at /);
  await assert.rejects(() => chooseFile(page, '#pick', f.a, { dialog: 'yes' }), /chooseFile: dialog must be 'accept' or 'dismiss'/);
  assert.equal(await page.evaluate('window.__clicks'), 0, 'a directory and a bad option are refused before any click');
  assert.deepEqual(await picks(page), []);
});

test('chooseFile: accepts a confirm() raised by the change handler, and returns the dialog', async (t) => {
  const f = files(t);
  const page = await open(t);
  const r = await within(chooseFile(page, '#restore-pick', f.a, { dialog: 'accept' }));
  assert.deepEqual(r, { dialogs: [{ type: 'confirm', message: CONFIRM }] });
  assert.deepEqual(await restores(page), ['file:a.txt', 'answer:true']);
});

test('chooseFile: dismisses a confirm() when asked to', async (t) => {
  const f = files(t);
  const page = await open(t);
  const r = await within(chooseFile(page, '#restore-pick', f.a, { dialog: 'dismiss' }));
  assert.deepEqual(r, { dialogs: [{ type: 'confirm', message: CONFIRM }] });
  assert.deepEqual(await restores(page), ['file:a.txt', 'answer:false']);
});

test('chooseFile: a dialog nobody asked for is dismissed and named, never left open', async (t) => {
  const f = files(t);
  const page = await open(t);
  const err = await within(chooseFile(page, '#restore-pick', f.a)).then(() => null, (e) => e);
  assert.ok(err, 'the pick is rejected');
  assert.match(err.message, /chooseFile: the page opened a confirm dialog during the pick/);
  assert.ok(err.message.includes(CONFIRM), 'the message names the dialog text');
  assert.deepEqual(await restores(page), ['file:a.txt', 'answer:false'], 'dismissed, not stuck');
  const r = await within(chooseFile(page, '#restore-pick', f.a, { dialog: 'accept' }));
  assert.equal(r.dialogs.length, 1);
  assert.deepEqual(await restores(page), ['file:a.txt', 'answer:false', 'file:a.txt', 'answer:true']);
});

// With interception off a plain click on the label makes headless Chrome fire
// the input's 'cancel' event at once (probe: bc-logs/q2f/probe-fix-1.log); with
// interception left on it would open an intercepted chooser instead.
async function assertPlainClickOpensNoChooser(page, when) {
  const chooser = [];
  const off = page.cdp.on((msg) => { if (msg.method === 'Page.fileChooserOpened') chooser.push(msg.params); });
  try {
    const before = await page.evaluate('window.__cancels');
    await page.clickSelector('#pick');
    const cancelled = await page.waitFor(`window.__cancels > ${before}`).then(() => true, () => false);
    assert.equal(chooser.length, 0, `${when}: a plain click opened an intercepted chooser`);
    assert.ok(cancelled, `${when}: a plain click did not reach the browser's own chooser`);
  } finally { off(); }
}

test('chooseFile: turns interception off after a pick and after a refused pick', async (t) => {
  const f = files(t);
  const page = await open(t);
  await chooseFile(page, '#pick', f.a);
  await assertPlainClickOpensNoChooser(page, 'after a pick');
  await assert.rejects(() => chooseFile(page, '#file', f.a), /cannot click: #file is hidden/);
  await assertPlainClickOpensNoChooser(page, 'after a refused pick');
});
