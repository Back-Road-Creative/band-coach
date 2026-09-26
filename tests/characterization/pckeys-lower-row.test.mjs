// CURRENT BEHAVIOUR (this change): the keyboard mod's computer-key entry
// reaches a second, lower octave -- the bottom letter row z x c v b n m
// plays the naturals C3 up to B3 -- alongside the existing upper row (a w s
// e d f t g y h u j k, C4 up to C5). Real `keydown`/`keyup` events through
// document, the same real entry point a learner without a MIDI device uses
// (never window.__coach.note(), which only proves the debug hook works).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function toHandsTogether(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

test('pressing a lower-row computer key (z=C3) is a real note-on: it lands the left-hand half of a hands-together pass', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');
  // z x c v b n m -> 48 50 52 53 55 57 59; every hands-together exercise's
  // left-hand note (48, 50, 52, 53, 55) is one of these.
  const LOWER_KEY_FOR_MIDI = { 48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b' };
  const lowerKey = LOWER_KEY_FOR_MIDI[info.ex.lh.midi];
  assert.ok(lowerKey, `left-hand note ${info.ex.lh.midi} should be reachable from the lower computer-key row`);
  const RH_KEY_FOR_MIDI = { 60: 'a', 62: 's', 64: 'd', 65: 'f', 67: 'g' };
  const rhKey = RH_KEY_FOR_MIDI[info.ex.rh.midi];

  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${rhKey}' }))`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${lowerKey}' }))`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'", 3000);
});

test('two computer keys held down together (one upper, one lower row) both register as note-ons: the hands-together task passes from real keydowns alone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toHandsTogether(page);

  const info = await page.evaluate('window.__coach.cur().info');
  const RH_KEY_FOR_MIDI = { 60: 'a', 62: 's', 64: 'd', 65: 'f', 67: 'g' };
  const LH_KEY_FOR_MIDI = { 48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b' };
  const rhKey = RH_KEY_FOR_MIDI[info.ex.rh.midi], lhKey = LH_KEY_FOR_MIDI[info.ex.lh.midi];

  // Two separate, real, near-simultaneous keydown events -- one from each
  // row -- neither carrying `repeat`. If only one had registered, the task
  // would still be waiting (className '') rather than 'ok'.
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${rhKey}' }))`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${lhKey}' }))`);
  await page.waitFor("document.getElementById('feedback').className === 'ok'", 3000);
});

test('a held key (`repeat: true`) is ignored, same as the upper row already was', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const id = await page.evaluate('window.__coach.cur().id');
  const now = await page.evaluate('window.__coach.modelNow()');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);

  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', repeat: true }))");
  await new Promise(r => setTimeout(r, 100));
  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.deepEqual(itemAfter, itemBefore, 'a repeated (held) keydown must not be treated as a fresh note-on');
});

test('typing a lower-row letter into a text INPUT does nothing to the exercise', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await page.evaluate(`(function () {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pckeys-test-input';
    document.body.appendChild(input);
    input.focus();
  })()`);
  const id = await page.evaluate('window.__coach.cur().id');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);

  await page.evaluate(`(function () {
    const input = document.getElementById('pckeys-test-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 100));
  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.deepEqual(itemAfter, itemBefore, 'a keydown targeting a text input must not be treated as a computer-key note-on');
});

test('typing a lower-row letter into a SELECT does nothing to the exercise', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await page.evaluate(`(function () {
    const sel = document.createElement('select');
    sel.id = 'pckeys-test-select';
    document.body.appendChild(sel);
    sel.focus();
  })()`);
  const id = await page.evaluate('window.__coach.cur().id');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);

  await page.evaluate(`(function () {
    const sel = document.getElementById('pckeys-test-select');
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 100));
  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.deepEqual(itemAfter, itemBefore, 'a keydown targeting a select must not be treated as a computer-key note-on');
});

test('typing a lower-row letter into a TEXTAREA does nothing to the exercise', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await page.evaluate(`(function () {
    const ta = document.createElement('textarea');
    ta.id = 'pckeys-test-textarea';
    document.body.appendChild(ta);
    ta.focus();
  })()`);
  const id = await page.evaluate('window.__coach.cur().id');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);

  await page.evaluate(`(function () {
    const ta = document.getElementById('pckeys-test-textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 100));
  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.deepEqual(itemAfter, itemBefore, 'a keydown targeting a textarea must not be treated as a computer-key note-on');
});

test('typing a lower-row letter into a contenteditable element does nothing to the exercise', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await page.evaluate(`(function () {
    const div = document.createElement('div');
    div.id = 'pckeys-test-editable';
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();
  })()`);
  const id = await page.evaluate('window.__coach.cur().id');
  const itemBefore = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);

  await page.evaluate(`(function () {
    const div = document.getElementById('pckeys-test-editable');
    div.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 100));
  const itemAfter = await page.evaluate(`window.__coach.state().item[${JSON.stringify(id)}]`);
  assert.deepEqual(itemAfter, itemBefore, 'a keydown targeting a contenteditable element must not be treated as a computer-key note-on');
});

test('the keyboard help text states the computer-key range in plain words, and names it screen/computer-key practice', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  const help = await page.evaluate("document.getElementById('helpText').textContent");
  assert.match(help, /\bz\b.*\bm\b/is, `expected the help text to name the lower-row keys z through m; got: ${help}`);
  assert.match(help, /C3/);
  assert.match(help, /not a real keyboard|screen[- ](and|or)[- ]computer-key|computer-key practice/i);
});
