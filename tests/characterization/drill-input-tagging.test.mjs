// A kbd drill answer's learning-event row now records `input`, the route
// that played the passing note -- 'midi' for a real MIDI note-on,
// 'computer-key' for the physical keyboard, 'screen' for a canvas tap or a
// canvas Enter/Space, and 'mic' for a note the microphone recognised.
// src/core/learning-events.js's isIndependentOk (C11c) then treats any kbd
// drill row whose input names a route other than 'midi' as practice, not
// proof the skill transferred to the instrument. Real entry points
// throughout (a fake MIDI port through the real ioBtn click handler, real
// DOM keydown/keyup, a real canvas pointerdown, a real Enter keydown after
// moving canvas focus) -- window.__coach.note() is only used in the control
// case, to prove the debug hook's no-source path stays untagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { PCKEYS } from '../../src/core/pckeys.js';

const htmlPath = HTML_PATH;

// Invert PCKEYS (midi -> key) once, same map every case reads from.
const MIDI_TO_KEY = {};
Object.keys(PCKEYS).forEach((k) => { MIDI_TO_KEY[PCKEYS[k]] = k; });

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

async function startDrill(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && !window.__coach.task().done');
  return page.evaluate('window.__coach.db().events.length');
}

async function newRows(page, before) {
  await page.waitFor(`window.__coach.db().events.length > ${before}`);
  return page.evaluate(`window.__coach.db().events.slice(${before})`);
}

test('a computer-key pass tags every new row input: computer-key, and none is independent', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const before = await startDrill(page);

  while (true) {
    const done = await page.evaluate('window.__coach.task().done');
    if (done) break;
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    const key = MIDI_TO_KEY[midi];
    assert.ok(key, `level-1 kbd target ${midi} should have a computer key`);
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`);
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keyup', { key: '${key}' }))`);
    await new Promise((r) => setTimeout(r, 30));
  }

  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => { assert.equal(r.input, 'computer-key'); assert.equal(isIndependentOk(r), false); });
  assert.deepEqual(page.exceptions, []);
});

test('a canvas pointerdown pass tags every new row input: screen, and none is independent', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const before = await startDrill(page);

  while (true) {
    const done = await page.evaluate('window.__coach.task().done');
    if (done) break;
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    const k = await page.evaluate(`window.__coach.kbdKeys().find(function (k) { return k.m === ${midi}; })`);
    assert.ok(k, `expected a drawn key rect for midi ${midi}`);
    const y = k.y + 0.85 * k.h;
    const pt = await page.evaluate(`
      (function () {
        const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
        return { clientX: r.left + ${k.x + k.w / 2} * r.width / cv.width, clientY: r.top + ${y} * r.height / cv.height };
      })()
    `);
    await page.evaluate(`document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', { clientX: ${pt.clientX}, clientY: ${pt.clientY}, bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 30));
  }

  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => { assert.equal(r.input, 'screen'); assert.equal(isIndependentOk(r), false); });
  assert.deepEqual(page.exceptions, []);
});

test('a canvas Enter pass tags every new row input: screen, and none is independent', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const before = await startDrill(page);

  while (true) {
    const done = await page.evaluate('window.__coach.task().done');
    if (done) break;
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    for (let guard = 0; guard < 40; guard++) {
      const focusM = await page.evaluate('window.__coach.kbdFocus() && window.__coach.kbdFocus().m');
      if (focusM === midi) break;
      const dir = focusM > midi ? 'ArrowLeft' : 'ArrowRight';
      await page.evaluate(`document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: '${dir}' }))`);
    }
    await page.evaluate("document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))");
    await new Promise((r) => setTimeout(r, 30));
  }

  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => { assert.equal(r.input, 'screen'); assert.equal(isIndependentOk(r), false); });
  assert.deepEqual(page.exceptions, []);
});

test('a real MIDI pass tags every new row input: midi, and each is independent', async (t) => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await midiAddPort(page, 'p1', 'Keys');
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");
  const before = await startDrill(page);

  while (true) {
    const done = await page.evaluate('window.__coach.task().done');
    if (done) break;
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await midiNoteOn(page, 'p1', midi);
    await new Promise((r) => setTimeout(r, 30));
  }

  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => { assert.equal(r.input, 'midi'); assert.equal(isIndependentOk(r), true); });
  assert.deepEqual(page.exceptions, []);
});

test('the debug hook with no source leaves input off the row, and it stays independent', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  const before = await startDrill(page);

  while (true) {
    const done = await page.evaluate('window.__coach.task().done');
    if (done) break;
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
    await new Promise((r) => setTimeout(r, 30));
  }

  const rows = await newRows(page, before);
  assert.ok(rows.length > 0);
  rows.forEach((r) => { assert.equal('input' in r, false); assert.equal(isIndependentOk(r), true); });
  assert.deepEqual(page.exceptions, []);
});
