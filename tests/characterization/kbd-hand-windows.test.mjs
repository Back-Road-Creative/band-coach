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

// Drives a level-8 task, correctly answering every element (which always
// advances to the next one -- see passEl()'s idx += 1, src/app.js ~1207),
// until the current target is a left-hand-octave note (midi < 60, the
// range drawn in row 0 -- see kbdRange()/the kbd draw branch, ~1828-1847).
// Level 8 (and above, since later levels fold earlier ones' items into their
// own pool) mixes notes from both octaves at random, so this can take a few
// elements. A finished task's next one is started by the app itself, on its
// own clock (src/app.js:1497's `nextTaskAt`), the same as
// journey-practice-progress.test.mjs's driveUntilJudged() relies on -- so
// this only ever waits for a task/cur() to (re)appear, never clicks #playBtn
// mid-drive.
async function untilTarget(page, matches) {
  for (let i = 0; i < 60; i++) {
    await page.waitFor('window.__coach.task() && window.__coach.cur()', 5000);
    const info = await page.evaluate('window.__coach.cur().info');
    if (info.kind === 'note' && matches(info)) return info;
    await page.evaluate(`window.__coach.note(${info.midi}, true)`);
    await page.waitFor('window.__coach.task() && window.__coach.cur()', 5000);
  }
  throw new Error('did not encounter a matching target within the search budget');
}
const untilLowNoteTarget = (page) => untilTarget(page, (info) => info.midi < 60);
// A row-0 C (midi 48): the one white key whose x lines up with its row-1
// counterpart (both rows start their first white key at the same x -- see
// the two draws in the kbd branch of draw(), src/app.js ~1844/1846). Picking
// any low note here would still usually catch a hit-test that ignores y or
// drops the row split, since the two rows differ in width and most notes'
// x DOES move between them -- but "usually" is not a guarantee, and this
// makes the check deterministic: the same x hits a real key in both rows,
// so nothing but the y-band (row) can be doing the telling apart.
const untilLowCTarget = (page) => untilTarget(page, (info) => info.midi < 60 && info.midi % 12 === 0);

async function tapAt(page, x, y) {
  const rect = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      return { clientX: r.left + ${x} * r.width / cv.width, clientY: r.top + ${y} * r.height / cv.height };
    })()
  `);
  await page.evaluate(`
    document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: ${rect.clientX}, clientY: ${rect.clientY}, bubbles: true,
    }))
  `);
}

test('a real pointerdown on a lower-row key plays that key, not the wrong row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.setViewport(VIEWPORTS.phone);
  await toLevel(page, 8);

  // Phase 1: tap the target's OWN rect, in row 0 (the left-hand octave) --
  // this must play the target and pass. Once an element has been failed,
  // passing it later reads back as neutral rather than 'ok' (passEl(),
  // src/app.js:1205's `else` branch), so this is checked on a fresh,
  // not-yet-failed element, before anything is tapped wrong.
  const info1 = await untilLowNoteTarget(page);
  const keys1 = await page.evaluate('window.__coach.kbdKeys()');
  const target1 = keys1.find((k) => k.m === info1.midi && (k.row || 0) === 0);
  assert.ok(target1, `expected the target (midi ${info1.midi}) to be drawn as a row-0 (left-hand) key`);
  await page.evaluate("document.getElementById('feedback').className = ''");
  await tapAt(page, target1.x + target1.w / 2, target1.y + target1.h / 2);
  await page.waitFor("document.getElementById('feedback').className === 'ok'");

  // Phase 2: a tap at the SAME x as a (fresh) low C target, but at the OTHER
  // row's y -- the pitch class one octave up, row 1 (the right-hand
  // octave). The keyboard is 'exact' octave policy (src/instruments/kbd.js),
  // so that is a genuinely wrong key, not an equivalent one: a wrong-row
  // hit-test (or no row split at all) would land on the target and pass;
  // the real one must land on the wrong-octave key instead and fail.
  const info2 = await untilLowCTarget(page);
  const keys2 = await page.evaluate('window.__coach.kbdKeys()');
  const target2 = keys2.find((k) => k.m === info2.midi && (k.row || 0) === 0);
  const wrongOctave = keys2.find((k) => k.m === info2.midi + 12 && (k.row || 0) === 1);
  assert.ok(target2, `expected the target (midi ${info2.midi}) to be drawn as a row-0 (left-hand) key`);
  assert.ok(wrongOctave, `expected midi ${info2.midi + 12} to be drawn as a row-1 (right-hand) key`);
  await page.evaluate("document.getElementById('feedback').className = ''");
  await tapAt(page, target2.x + target2.w / 2, wrongOctave.y + wrongOctave.h / 2);
  await page.waitFor("document.getElementById('feedback').className === 'no'");
});

// Requirement (4): arrow-key focus walks the left row low to high, then the
// right row. The rows are stacked, so a plain left-to-right sort by x would
// interleave them (C3, C4, C#3, C#4 ...); walking the order must give
// strictly rising pitches, left-hand keys first.
test('arrow-key focus walks the left row low to high, then the right row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await toLevel(page, 8);

  await page.evaluate("document.getElementById('cv').focus()");
  const start = await page.evaluate('window.__coach.kbdFocus()');
  assert.ok(start, 'a key should be focused once the canvas has focus');
  for (let i = 0; i < start.total; i++) {
    await page.evaluate(`
      document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    `);
  }
  const first = await page.evaluate('window.__coach.kbdFocus()');
  assert.equal(first.idx, 0, 'ArrowLeft should stop at the first key');
  const byIdx = new Map([[first.idx, first.m]]);
  for (let i = 1; i < first.total; i++) {
    await page.evaluate(`
      document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    `);
    const f = await page.evaluate('window.__coach.kbdFocus()');
    byIdx.set(f.idx, f.m);
  }
  assert.equal(byIdx.size, first.total, 'ArrowRight should visit every key once');
  const walk = [...byIdx.keys()].sort((a, b) => a - b).map(i => byIdx.get(i));
  for (let i = 1; i < walk.length; i++) {
    assert.ok(walk[i] > walk[i - 1], `focus order should rise in pitch, got ${walk.join(',')}`);
  }
  assert.ok(walk[0] < 60 && walk[walk.length - 1] >= 60, `left row first, right row last, got ${walk.join(',')}`);
});
