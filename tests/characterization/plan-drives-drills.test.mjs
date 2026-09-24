// P5-1: today's plan (src/core/curriculum.js's planSession/describePlan,
// steered through src/app.js's buildLevelTask via nextPlanStep) now drives
// the drill chooser, not just the coach line -- the review block's ids form
// the pool first, then the weakest skill gets a focused run, then it is
// used inside a short phrase, then a blind check, and only once that
// four-block plan is exhausted does the session fall back to today's
// ordinary level chooser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const MAX_TASKS = 40;

// Drives every element of the current task with a correct answer, the same
// real entry point (window.__coach.note) a learner's MIDI keyboard or the
// on-screen keys would fire, then waits for the next task to be built.
async function driveOneCorrectTask(page) {
  await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  for (let k = 0; k < 12; k++) {
    const state = await page.evaluate(
      `(function () { const t = window.__coach.task(), c = window.__coach.cur();
        return { done: !!(t && t.done), midi: c && c.info ? c.info.midi : null }; })()`
    );
    if (state.done || state.midi === null) break;
    await page.evaluate(`window.__coach.note(${state.midi}, true)`);
  }
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);
}

test('the plan drives the drill chooser: review, then the weak skill, then applying it, then a blind check', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // One overdue, once-lapsed item (n60 = C4) -- planSession picks it for
  // both the review block (it has an item record and is far overdue) and
  // the weak block (a past lapse outranks a merely-low-retrievability id).
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.item = { n60: { stability: 5, difficulty: 0.3, lastSeen: Date.now() - 100 * 86400000, reps: 4, lapses: 1, seen: 5 } };
    db.mods.kbd.judged = 0;
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  // S.judged <= 5 keeps startSession() off the warm-up branch (src/app.js:
  // `S.judged > 5 && !customOn`), so the very first task is already the
  // plan's own review step, not four warm-up reps.
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()', 5000);

  const isWarm = await page.evaluate('!!(window.__coach.task() && window.__coach.task().warm)');
  assert.equal(isWarm, false, 'expected no warm-up with S.judged <= 5, so the plan drives the first task');

  const firstId = await page.evaluate("window.__coach.task().els[0].id");
  assert.equal(firstId, 'n60', "expected the plan's review block to steer the very first task to n60");

  const progressAfterFirst = await page.evaluate('Object.assign({}, window.__coach.planProgress())');
  assert.ok(progressAfterFirst.review >= 0, 'expected planProgress() to be exposed on the debug hook');

  // Drive tasks through review (1) + weak (3) + apply (2) + check (1) = 7,
  // watching for the blind check step along the way (task.blind === true,
  // no reveal on any element) and confirming the apply step used n60 inside
  // a short phrase, not on its own.
  let sawBlindCheck = false, sawApplySeqWithWeak = false;
  for (let i = 0; i < 7; i++) {
    // finishTask() leaves the just-finished task in place for a beat
    // (nextTaskAt, src/app.js) before frame() swaps in the next one, so a
    // read right after driveOneCorrectTask() can still see the stale,
    // already-done task -- wait for a fresh, not-yet-done one first.
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const before = await page.evaluate(
      "(function(){ const t = window.__coach.task(); return { kind: t.kind, blind: t.blind, els: t.els.map(e => e.id), reveal: t.els.map(e => e.reveal) }; })()"
    );
    if (before.blind && before.els.length) { sawBlindCheck = true; assert.ok(before.reveal.every(r => r === false), 'a blind check task must never reveal'); }
    if (before.kind === 'seq' && before.els.indexOf('n60') >= 0 && before.els.length === 3) sawApplySeqWithWeak = true;
    await driveOneCorrectTask(page);
  }
  assert.ok(sawBlindCheck, 'expected the plan to eventually hand back a blind check task');
  assert.ok(sawApplySeqWithWeak, 'expected the apply block to build a 3-note phrase containing the weak id n60');

  const progressAfterPlan = await page.evaluate('Object.assign({}, window.__coach.planProgress())');
  assert.equal(progressAfterPlan.review, 1);
  assert.equal(progressAfterPlan.weak, 3);
  assert.equal(progressAfterPlan.apply, 2);
  assert.equal(progressAfterPlan.check, 1);

  // The plan (4 blocks: 1 + 3 + 2 + 1 = 7 tasks) is now exhausted -- the
  // next task must fall back to today's ordinary level chooser: never
  // blind (level 1's own level def carries no `blind` flag).
  await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  const fallbackTask = await page.evaluate(
    "(function(){ const t = window.__coach.task(); return { blind: t.blind, els: t.els.map(e => e.id) }; })()"
  );
  assert.equal(fallbackTask.blind, false, 'expected the level chooser (not the exhausted plan) to be driving once all four blocks are done');
});
