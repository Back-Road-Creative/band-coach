// D2 (Wave kbd): at a phone viewport (390x844) the two-row kbd layout
// (B2/kbd-hand-windows) still left the narrowest white key just under the
// 40px target this unit raises the floor to, and gave a learner no sense of
// where the drawn two-octave window sits inside the full 88-key range. This
// pins: (1) every white key hit rect is at least 40 CSS px wide on a phone
// canvas, and (2) a new window.__coach.kbdOverview() debug hook reports a
// full-keyboard (A0-C8, MIDI 21-108) strip marking the drawn window, without
// adding any new keyRects/focus stops of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, VIEWPORTS } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const TAP_TARGET_FLOOR_PX = 40;

async function toLevel13(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 13');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

test('at the phone viewport, level 13 white keys clear the 40px tap-target floor', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORTS.phone);
  await toLevel13(page);

  const { keys, ratio } = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      return { keys: window.__coach.kbdKeys(), ratio: r.width / cv.width };
    })()
  `);
  const white = keys.filter((k) => !k.black);
  assert.ok(white.length > 0, 'expected at least one white key');
  const narrowestCssPx = Math.min(...white.map((k) => k.w * ratio));
  assert.ok(
    narrowestCssPx >= TAP_TARGET_FLOOR_PX,
    `narrowest white key hit rect is ${narrowestCssPx.toFixed(2)}px, expected >= ${TAP_TARGET_FLOOR_PX}px`
  );
});

test('the full-keyboard overview marks the drawn window and adds no hit rects of its own', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORTS.phone);
  await toLevel13(page);

  const keys = await page.evaluate('window.__coach.kbdKeys()');
  assert.equal(keys.length, 25, `expected 25 keys at level 13, got ${keys.length}`);
  assert.ok(keys.every((k) => k.m >= 48 && k.m <= 72), 'every key should be within MIDI 48-72');
  const midis = keys.map((k) => k.m);
  const minM = Math.min(...midis), maxM = Math.max(...midis);
  assert.deepEqual([minM, maxM], [48, 72]);

  const ov = await page.evaluate('window.__coach.kbdOverview()');
  assert.ok(ov, 'expected window.__coach.kbdOverview() to report a non-null overview');
  assert.equal(ov.lo, 21, 'overview should span the full keyboard starting at A0 (MIDI 21)');
  assert.equal(ov.hi, 108, 'overview should span the full keyboard ending at C8 (MIDI 108)');
  assert.deepEqual([ov.win.lo, ov.win.hi], [minM, maxM], 'the marked window should match the drawn keys range');

  assert.ok(ov.win.x >= ov.x, 'the window rect should start at or after the overview strip');
  assert.ok(ov.win.x + ov.win.w <= ov.x + ov.w + 0.5, 'the window rect should end at or before the overview strip');

  const keyMaxY = Math.max(...keys.map((k) => k.y + k.h));
  const keyMinY = Math.min(...keys.map((k) => k.y));
  assert.ok(
    ov.y >= keyMaxY || ov.y + ov.h <= keyMinY,
    'the overview must occupy a y-band that does not overlap the keys'
  );
});

// Requirement: neither the rows nor the overview window move during a
// phrase -- the layout depends only on kr (kbdRange()), never on
// task/task.idx, and this drives one full hands-together element (both
// hands, the same pattern as kbd-hands-together.test.mjs) to prove it.
test('neither the keyboard rows nor the overview window move during a phrase', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel13(page);

  const strip = (k) => ({ m: k.m, x: k.x, y: k.y, w: k.w, h: k.h, black: k.black, row: k.row, hand: k.hand });
  const before = (await page.evaluate('window.__coach.kbdKeys()')).map(strip);
  const ovBefore = await page.evaluate('window.__coach.kbdOverview()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');
  const idxBefore = await page.evaluate('window.__coach.task().idx');
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await page.evaluate(`window.__coach.note(${info.ex.lh.midi}, true)`);
  await page.waitFor(`window.__coach.task() && window.__coach.task().idx !== ${idxBefore}`);
  await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);

  const after = (await page.evaluate('window.__coach.kbdKeys()')).map(strip);
  const ovAfter = await page.evaluate('window.__coach.kbdOverview()');
  assert.deepEqual(after, before, 'keyRects geometry must not change between task elements');
  assert.deepEqual(ovAfter, ovBefore, 'the overview window must not change between task elements');
});
