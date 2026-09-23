// VERIFIED DEFECT (save-flush-on-pagehide): save() (src/app.js) debounces its
// localStorage write 1200ms (setTimeout). Nothing flushes that pending timer
// early -- there is no pagehide or beforeunload listener at all, and the
// existing visibilitychange listener (src/app.js) only calls
// takeBreak()/wakeLock.handleVisibilityChange(), never save(). A learner who
// answers and then closes or reloads the tab within 1.2s loses that answer:
// the debounced write never runs.
//
// This proves the fix with a single SYNCHRONOUS evaluate() call rather than a
// wall-clock wait: a real pagehide dispatch happens in the same JS tick as
// the answer, so a slow/loaded test runner (this box regularly reads a load
// average past 1.0 per core) can never let the 1200ms debounce fire on its
// own and produce a false pass -- only an explicit flush inside a pagehide
// handler can make localStorage.setItem land before the debounce timer's
// callback could possibly have run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

const COUNT_SET_ITEM_SCRIPT = `
  window.__setItemCount = 0;
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (...args) {
    window.__setItemCount++;
    return origSetItem.apply(this, args);
  };
`;

test('an answer given right before the tab closes is still saved', async (t) => {
  const page = await launchPage(htmlPath, { initScript: COUNT_SET_ITEM_SCRIPT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');

  // Everything from here happens inside ONE evaluate() call: the answer, the
  // pagehide dispatch, and the localStorage read are all in the same JS
  // tick, so no real time passes in which the 1200ms debounce timer could
  // fire on its own.
  const result = await page.evaluate(`
    (function () {
      window.__coach.note(${midi}, true);
      const preFlushCount = window.__setItemCount;
      window.dispatchEvent(new Event('pagehide'));
      const postFlushCount = window.__setItemCount;
      return { preFlushCount, postFlushCount, raw: localStorage.getItem('bandcoach.v1') };
    })()
  `);

  assert.ok(
    result.postFlushCount > result.preFlushCount,
    `expected pagehide to flush the pending save synchronously (setItem calls before: ${result.preFlushCount}, after: ${result.postFlushCount})`
  );
  assert.ok(result.raw, 'expected a save to have landed in localStorage by the time pagehide returns');
  const parsed = JSON.parse(result.raw);
  assert.ok(parsed.mods && parsed.mods.kbd && parsed.mods.kbd.item, 'parsed DB has mods.kbd.item');
  assert.ok(Object.keys(parsed.mods.kbd.item).length > 0, 'the answer was recorded before pagehide, not lost to a still-pending debounce');
});
