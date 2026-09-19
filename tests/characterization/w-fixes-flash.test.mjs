// Item 1 (Wave W, unit w-fixes): flashBad/flashGood started at 0, so
// `performance.now() - flashBad < 220` was true for roughly the first 220ms
// after the page loaded, drawing a spurious red border (and a wrong '✗')
// before the learner has done anything. Checking the raw stored values
// (rather than racing the 220ms window over a CDP round trip, which the
// browser's own launch overhead already blows past) is the deterministic
// way to pin this: they must start far enough in the past that
// performance.now() - value is never mistaken for a fresh flash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('flashBad/flashGood start far in the past, not at 0', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const flash = await page.evaluate('window.__coach.flash()');
  assert.ok(flash.bad < -1e6, `flashBad should start far in the past, not 0 (got ${flash.bad})`);
  assert.ok(flash.good < -1e6, `flashGood should start far in the past, not 0 (got ${flash.good})`);
});

test('the red/green flash border is not drawn before any answer', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  const nowVsFlash = await page.evaluate(`
    (function () {
      const f = window.__coach.flash();
      return [performance.now() - f.bad, performance.now() - f.good];
    })()
  `);
  assert.ok(nowVsFlash[0] >= 220, 'performance.now() - flashBad should already be well past the 220ms flash window');
  assert.ok(nowVsFlash[1] >= 220, 'performance.now() - flashGood should already be well past the 220ms flash window');
});
