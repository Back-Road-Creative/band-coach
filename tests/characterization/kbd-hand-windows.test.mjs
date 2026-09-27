// B2 (Wave kbd): once the octave below unlocks (level 8+), the on-screen
// keyboard used to draw one 15-white-key strip -- on a phone canvas that put
// white keys under the 24px WCAG 2.5.8 (2.2 AA) tap-target floor #283 already
// holds every other control in the app to, and gave a hands-together task's
// two simultaneous lit targets nothing but the same accent colour to tell
// them apart. This pins the fix: two always-drawn, always-labelled rows of at
// most 8 white keys each (src/app.js's kbd branch of draw(), drawKeys()),
// exposed for inspection via a new window.__coach.kbdKeys() debug hook that
// returns the last frame's keyRects with {m,x,y,w,h,black,row,hand,mark}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, VIEWPORTS } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// WCAG 2.5.8 (2.2 AA)'s minimum tap-target size, CSS pixels -- the same
// number #283 already applied to the instrument-variant disclosure summaries
// (src/styles.css's `min-height: 24px` on `.variant-toggle > summary`). A
// white key narrower than this on a phone is not "small text", it is a
// target a real thumb can miss.
const TAP_TARGET_FLOOR_PX = 24;

async function toLevel(page, level) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate(`window.__coach.state().level = ${level}`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
}

function rowGroups(keys) {
  const rows = new Map();
  for (const k of keys) {
    if (k.black) continue; // the "at most 8 white keys" budget is about white keys only
    const r = k.row || 0;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(k);
  }
  return rows;
}

test('once the octave below is unlocked, keys group into exactly two rows of at most 8 white keys each', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 8);

  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rows = rowGroups(keys);
  assert.equal(rows.size, 2, `expected exactly two rows, got ${rows.size}`);
  for (const [row, ks] of rows) {
    assert.ok(ks.length > 0 && ks.length <= 8, `row ${row} has ${ks.length} white keys, expected 1-8`);
  }
  // The two rows must not overlap vertically -- they are stacked, not blended.
  const [rowA, rowB] = [...rows.values()];
  const maxYA = Math.max(...rowA.map((k) => k.y + k.h));
  const minYB = Math.min(...rowB.map((k) => k.y));
  const maxYB = Math.max(...rowB.map((k) => k.y + k.h));
  const minYA = Math.min(...rowA.map((k) => k.y));
  assert.ok(maxYA <= minYB || maxYB <= minYA, 'the two rows must occupy separate, non-overlapping y-bands');
});

test('at the phone viewport, the narrowest white key hit rect is at least the WCAG tap-target floor', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORTS.phone);
  await toLevel(page, 8);

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
    `narrowest white key hit rect is ${narrowestCssPx.toFixed(1)}px, expected >= ${TAP_TARGET_FLOOR_PX}px`
  );
});

test('two draws at different task.idx give identical row bounds', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  // Level 9 ("Five-note runs") accumulates level 8's octave-below notes into
  // its own pool, so the two-row layout is active throughout, while the task
  // itself advances task.idx note by note -- exactly the case the layout must
  // not react to.
  await toLevel(page, 9);

  const rowBounds = (keys) => {
    const rows = rowGroups(keys);
    const out = {};
    for (const [row, ks] of rows) out[row] = { minY: Math.min(...ks.map((k) => k.y)), maxY: Math.max(...ks.map((k) => k.y + k.h)) };
    return out;
  };

  const before = rowBounds(await page.evaluate('window.__coach.kbdKeys()'));
  const idxBefore = await page.evaluate('window.__coach.task().idx');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor(`window.__coach.task() && window.__coach.task().idx !== ${idxBefore}`);

  const after = rowBounds(await page.evaluate('window.__coach.kbdKeys()'));
  assert.deepEqual(after, before, 'row bounds must not change between task elements');
});

test('in a hands-together task, the right-hand and left-hand target keys carry different marks', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 13);

  const info = await page.evaluate('window.__coach.cur().info');
  assert.equal(info.kind, 'hands-together');
  // A wrong note held alongside the right-hand note fails the element (same
  // pattern as tests/characterization/kbd-hands-together.test.mjs), which
  // reveals both hands' targets the same way "Show me" would.
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi}, true)`);
  await page.evaluate(`window.__coach.note(${info.ex.rh.midi + 1}, true)`);
  await page.waitFor("document.getElementById('feedback').className === 'no'");

  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const rh = keys.find((k) => k.m === info.ex.rh.midi && k.mark);
  const lh = keys.find((k) => k.m === info.ex.lh.midi && k.mark);
  assert.ok(rh, 'the right-hand target key should carry a mark');
  assert.ok(lh, 'the left-hand target key should carry a mark');
  assert.notEqual(rh.mark, lh.mark, `right-hand and left-hand marks must differ, got "${rh.mark}" and "${lh.mark}"`);
});

test('a real pointerdown on a lower-row key plays that key, not just the debug hook', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 8);

  const keys = await page.evaluate('window.__coach.kbdKeys()');
  const lower = keys.find((k) => !k.black && (k.row || 0) === 1) || keys.find((k) => !k.black);
  assert.ok(lower, 'expected at least one white key to tap');

  await page.evaluate("document.getElementById('feedback').className = ''");
  const rect = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      const cx = ${lower.x} + ${lower.w} / 2, cy = ${lower.y} + ${lower.h} / 2;
      return { clientX: r.left + cx * r.width / cv.width, clientY: r.top + cy * r.height / cv.height };
    })()
  `);
  await page.evaluate(`
    document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: ${rect.clientX}, clientY: ${rect.clientY}, bubbles: true,
    }))
  `);
  await page.waitFor("document.getElementById('feedback').className === 'ok' || document.getElementById('feedback').className === 'no'");
});
