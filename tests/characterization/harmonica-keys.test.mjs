// The harmonica mod used to be hard-wired to a C harmonica (a fixed HARP.b/
// HARP.d table). This proves the real, shipped wiring -- the "My harmonica
// is in the key of" selector, and the note the app actually asks the
// learner to play -- follows the chosen key, through the real entry point
// (renderOpts' <select>), not just the pure layoutFor() helper underneath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { layoutFor } from '../../src/instruments/how/harmonica.js';

const htmlPath = HTML_PATH;

test('the harp options panel offers a 12-key selector once harp is the active mod', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('harp')");
  await page.waitFor("document.getElementById('optHarpKey')");
  const optionCount = await page.evaluate("document.getElementById('optHarpKey').options.length");
  assert.equal(optionCount, 12, 'the key selector must offer exactly the 12 keys');
});

test('the current exercise\'s pitch follows the selected key, not a fixed C table', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('harp')");
  // Change key through the real <select>, the same way a learner would --
  // set the value and fire a real 'change' event so renderOpts' own
  // listener runs (rather than poking DB.prefs directly).
  await page.evaluate(`
    const s = document.getElementById('optHarpKey');
    s.value = '5';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  const harpKey = await page.evaluate('window.__coach.db().prefs.harpKey');
  assert.equal(harpKey, 5, 'selecting a key in the UI must update DB.prefs.harpKey');

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const info = await page.evaluate('window.__coach.cur().info');

  const expected = layoutFor(5)[info.hole - 1][info.dir === 'b' ? 'blow' : 'draw'];
  assert.equal(info.midi, expected, `hole ${info.hole} ${info.dir} in key 5 should be midi ${expected}, got ${info.midi}`);
});

test('changing the key mid-session drops the stale task, so the very next exercise already uses the new key', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('harp')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  // Same UI action as renderOpts' optWind handler (task = null; save()) --
  // the harp key selector's on-change handler must clear task the same way,
  // so nothing left over from the old key can still be asked. The game loop
  // (src/app.js: `if (!task ...) task = buildTask()`) rebuilds it on its own
  // next tick, without another click.
  await page.evaluate(`
    const s = document.getElementById('optHarpKey');
    s.value = '9';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await page.waitFor('window.__coach.task()');
  const info = await page.evaluate('window.__coach.cur().info');

  const expected = layoutFor(9)[info.hole - 1][info.dir === 'b' ? 'blow' : 'draw'];
  assert.equal(info.midi, expected, `after switching to key 9, the next exercise must use key 9's own pitch (hole ${info.hole} ${info.dir} = ${expected}), got ${info.midi}`);
});

// Real entry point for validId() on a bend id: the progress-backup
// import/export round trip, which runs every item id in a restored backup
// through sanitizeDB -> validId before keeping it (src/app.js doImportProgress).
test('a real (in-range) bend id survives a backup round trip; a fabricated depth does not', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const envelope = {
    format: 'band-coach-progress',
    formatVersion: 1,
    appVersion: 'test',
    exportedAt: new Date().toISOString(),
    db: {
      v: 1,
      mods: { harp: { item: { y3x3: {}, y3x9: {} } } }, // hole 3 has bend depths 1-3 only; x9 does not exist
      sessions: [],
      prefs: { mod: 'harp', wind: 'bb', voice: 'low', names: true, noiseFloor: null, inputDeviceId: null, harpKey: 3, notate: {} },
    },
  };

  await page.evaluate(`window.__coach.importProgress(${JSON.stringify(JSON.stringify(envelope))})`);
  const items = await page.evaluate('Object.keys(window.__coach.db().mods.harp.item)');
  assert.ok(items.includes('y3x3'), 'a real bend id (hole 3, depth 3) must survive the round trip');
  assert.ok(!items.includes('y3x9'), 'a bend depth that does not exist on that hole must be dropped by validId');
});
