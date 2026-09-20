// mallet-percussion (src/instruments/mallet-percussion.js) ships status:
// 'ready' with a MODS['mallet-percussion'] entry in src/app.js -- this
// drives it end to end the same way
// tests/characterization/fretted-instruments-playable.test.mjs drives the
// five fretted additions: select it, get a task, answer the correct note
// both through the debug hook directly and through the real mic pipeline
// (testPluck), and see it credited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

test('mallet-percussion: selectable, and answering the task note correctly credits it', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('mallet-percussion')");
  assert.equal(await page.evaluate('window.__coach.db().prefs.mod'), 'mallet-percussion', 'mallet-percussion should be selectable via setMod');

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'note', 'mallet-percussion level 1 should hand out a note task');
  assert.ok(Number.isFinite(info.midi), 'mallet-percussion task note should have a real midi pitch');

  await page.evaluate(`window.__coach.note(${info.midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 4000);

  assert.equal(
    await page.evaluate('window.__coach.task().idx'),
    1,
    'mallet-percussion: the correct note should have been credited'
  );
});

test('mallet-percussion: a real microphone pluck at the task pitch is credited', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('mallet-percussion')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  const freq = midiToFreq(info.midi);
  await page.evaluate(`window.__coach.testPluck(${freq}, [0])`);

  await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

  assert.equal(
    await page.evaluate('window.__coach.task().idx'),
    1,
    'mallet-percussion: the real mic pluck should have been credited'
  );
});

test('mallet-percussion: registry range is inside a frame size of 2048 (no low-note frame bump needed)', async () => {
  const rec = byId['mallet-percussion'];
  assert.equal(rec.range.low, 60, 'sanity: C4');
  // frameSizeForInstrument only grows past 2048 for a range.low far lower
  // than C4 (see bass-5-string.js) -- this is a direct check the registry
  // range this record ships did not silently change under that threshold.
  assert.ok(rec.range.low >= 48, 'mallet-percussion range.low should stay well above the frame-size-bump threshold');
});
