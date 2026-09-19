// CURRENT BEHAVIOUR: progress is written to localStorage['bandcoach.v1'] on a
// debounce, and whatever is loaded back is sanitised (sanitizeDB, :337) —
// clamped ranges, unknown ids dropped, non-objects replaced with a fresh
// model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('answers persist to localStorage under the known key', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);

  // save() debounces at 1.2s (src/app.js:217). Poll rather than a short fixed
  // wait: under CPU load the debounced write can land well past 1.2s.
  await page.waitFor("localStorage.getItem('bandcoach.v1') !== null", 10000);
  const raw = await page.evaluate("localStorage.getItem('bandcoach.v1')");
  const parsed = JSON.parse(raw);
  assert.ok(parsed.mods && parsed.mods.kbd && parsed.mods.kbd.item, 'parsed DB has mods.kbd.item');
  assert.ok(Object.keys(parsed.mods.kbd.item).length > 0, 'at least one item was recorded');
});

test('garbage preloaded into localStorage is sanitised on load', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const garbage = JSON.stringify({
    v: 1,
    mods: {
      kbd: {
        level: 9999,
        ready: 0.2,
        item: {
          n60: { m: 0.5, n: 1, last: 0, seen: 0 },
          notAnId: { m: 0.5, n: 1, last: 0, seen: 0 },
        },
      },
    },
    sessions: 'not an array',
    prefs: 42,
  });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(garbage)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  await page.waitFor("window.__coach.db().mods.kbd", 5000);

  const kbdModel = await page.evaluate('window.__coach.db().mods.kbd');
  assert.ok(kbdModel.level <= 80, `level must be clamped to <= 80, got ${kbdModel.level}`);
  assert.ok(!('notAnId' in kbdModel.item), 'an invalid item id must be dropped');
  assert.ok('n60' in kbdModel.item, 'a valid item id survives sanitising');
});
