// A warm-up task tells the learner "does not count" (see the hint text at
// src/app.js's task-render call: `t.warm ? 'Warm-up, does not count. ' : ''`,
// and the startSession() coach message "First a short warm-up through what
// you know; it does not count."). credit() must honor that: a correct
// warm-up answer must leave S.item[id] untouched, while a normal answer
// after the warm-up still updates it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const MAX_TASKS = 60;

async function driveOneCorrectAnswer(page) {
  await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  for (let k = 0; k < 12; k++) {
    const state = await page.evaluate(
      `(function () { const t = window.__coach.task(), c = window.__coach.cur();
        return { done: !!(t && t.done), midi: c && c.info ? c.info.midi : null,
                 paused: !document.getElementById('breakCard').hidden }; })()`
    );
    if (state.paused) { await page.evaluate("document.getElementById('backBtn').click()"); continue; }
    if (state.done || state.midi === null) break;
    await page.evaluate(`window.__coach.note(${state.midi}, true)`);
  }
}

test('warm-up: a correct warm-up answer does not update S.item, but the following normal answer does', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  // Force startSession() down the warm-up branch: `S.judged > 5 && !customOn`
  // (src/app.js:1531) is the only gate on sess.warm, so bump S.judged before
  // pressing Start.
  await page.evaluate("window.__coach.state().judged = 10");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()', 5000);

  const isWarm = await page.evaluate('!!(window.__coach.task() && window.__coach.task().warm)');
  assert.equal(isWarm, true, 'startSession() with S.judged > 5 should hand back a warm-up task first');

  // `it(id, now)` (src/app.js) lazily creates a default S.item[id] entry the
  // moment an item is merely scored for selection (pick()/weight()), well
  // before credit() runs — so S.item[id] already exists by the time a warm-up
  // task is on screen. The invariant under test is therefore not "absent",
  // but "unchanged by the warm-up answer": snapshot before, compare after.
  let sawWarmItem = false;
  for (let i = 0; i < MAX_TASKS && (await page.evaluate('!!(window.__coach.task() && window.__coach.task().warm)')); i++) {
    const id = await page.evaluate('window.__coach.cur() && window.__coach.cur().id');
    const before = id ? await page.evaluate(`window.__coach.state().item['${id}']`) : null;
    await driveOneCorrectAnswer(page);
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    if (id) {
      const after = await page.evaluate(`window.__coach.state().item['${id}']`);
      assert.deepEqual(after, before, `warm-up answer for ${id} must not change S.item[${id}]`);
      sawWarmItem = true;
    }
  }
  assert.ok(sawWarmItem, 'expected at least one warm-up element to be answered and checked');

  // Now off warm-up: the next correct answer must update S.item.
  const afterWarmId = await page.evaluate('window.__coach.cur() && window.__coach.cur().id');
  assert.ok(afterWarmId, 'expected a normal (non-warm) task after the warm-up run');
  const stillWarm = await page.evaluate('!!(window.__coach.task() && window.__coach.task().warm)');
  assert.equal(stillWarm, false, 'expected to have moved past the warm-up tasks');
  const beforeNormal = await page.evaluate(`window.__coach.state().item['${afterWarmId}']`);
  await driveOneCorrectAnswer(page);
  await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  const normalItem = await page.evaluate(`window.__coach.state().item['${afterWarmId}']`);
  assert.ok(normalItem, `a normal answer for ${afterWarmId} must leave an S.item[${afterWarmId}] entry`);
  assert.equal(
    normalItem.reps,
    (beforeNormal ? beforeNormal.reps : 0) + 1,
    `a normal (non-warm) answer for ${afterWarmId} must run review() and bump reps, unlike the warm-up answers above`
  );
});
