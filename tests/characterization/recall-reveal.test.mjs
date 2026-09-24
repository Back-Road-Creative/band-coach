// These tests assert the CORRECT recall-safe behaviour for the two flaws
// named in the evaluation plan, and were RED against src/app.js before
// src/core/reveal.js was wired in:
//
// F2 (src/app.js hintFor(), string branch): the hint always printed the
// string/fret answer for a string/fret item, whether or not the item was
// revealed — recall was never actually tested.
//
// F3 (src/app.js drawHarp(), `e.reveal || e.failed || true`, and the
// harmonica prompt text): the target hole was always lit and the prompt
// named the hole+direction outright, regardless of reveal state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;
const MAX_TASKS = 60;

// Drives the current mod's task loop, answering correctly every time, until
// it lands on a task whose current element is not revealed and not failed
// (i.e. past its first two exposures) — the state in which recall should
// actually be tested. Returns once such a task is current, or throws.
async function driveToUnrevealed(page) {
  for (let i = 0; i < MAX_TASKS; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const e = await page.evaluate('window.__coach.cur()');
    if (e && e.reveal === false && !e.failed) return e;
    // Answer every element of this task, not just the first: a task with more
    // than one note never reports done after a single answer, and a break card
    // can take the task away entirely (CI flake, 2026-09-19).
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
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  }
  throw new Error(`no unrevealed task appeared within ${MAX_TASKS} tasks`);
}

test('recall (flaw F2): the guitar hint does not name the string or fret before the item is revealed', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const e = await driveToUnrevealed(page);
  assert.ok(e.info.string, 'level-1 gtr items are string/fret notes');

  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.ok(
    !hint.includes('String ' + e.info.string),
    `expected the un-revealed hint not to leak "String ${e.info.string}"; got: ${hint}`
  );
});

test('recall (flaw F3): the harmonica target hole is unlit and the prompt asks for the note, not the hole, before reveal', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('harp')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const e = await driveToUnrevealed(page);
  assert.ok(e.info.hole, 'harp items have a hole');

  const prompt = await page.evaluate("document.getElementById('prompt').textContent");
  assert.ok(
    !/blow|draw/i.test(prompt),
    `expected the un-revealed prompt to ask for the note, not the hole/direction; got: ${prompt}`
  );

  const lit = await page.evaluate(`
    (function () {
      const cv = document.getElementById('cv');
      const ctx = cv.getContext('2d');
      const hole = window.__coach.cur().info.hole;
      const W = cv.width, H = cv.height;
      const x0 = W * 0.06, w = W * 0.88, hw = w / 10, y0 = H * 0.36, hh = H * 0.3;
      const x = Math.round(x0 + (hole - 1) * hw + hw * 0.5);
      const y = Math.round(y0 + hh * 0.5);
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return !(r === 5 && g === 7 && b === 12);
    })()
  `);
  assert.equal(lit, false, 'expected the un-revealed target hole to render unlit');
});

// "Show me" (Unit 2.3, step 3; B3): a visible, keyboard-operable button that
// reveals the current item on request. B3 changed the contract from "shown
// counts as a failed recall" to "shown is a help event, not a test": asking
// for help used to be recorded as a failed recall, which drove the item's
// stability down and the learner's level back — punishing the learner for
// asking. Now a shown-then-played element leaves the SRS record (stability,
// lapses, due) and S.ready (level progress) exactly as they were; only the
// session's help counter moves.
test('Show me: reveals the current item as help, not a failure, and leaves the SRS record untouched', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const e = await driveToUnrevealed(page);
  const before = await page.evaluate(`window.__coach.state().item['${e.id}']`);
  const readyBefore = await page.evaluate('window.__coach.state().ready');
  const judgedBefore = await page.evaluate('window.__coach.state().judged');
  const sessJudgedBefore = await page.evaluate('window.__coach.sess().judged');

  await page.evaluate('window.__coach.showMe()');

  const afterReveal = await page.evaluate('window.__coach.cur()');
  assert.equal(afterReveal.reveal, true, 'showMe() reveals the current element');
  assert.equal(afterReveal.helped, true, 'showMe() marks the element helped');
  assert.equal(afterReveal.failed, false, 'showMe() does not mark the element failed');

  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.ok(hint.includes('String ' + e.info.string), 'the hint now shows the full answer once revealed');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const after = await page.evaluate(`window.__coach.state().item['${e.id}']`);
  assert.equal(after.stability, before.stability, 'a shown-then-played answer must not change stability');
  assert.equal(after.lapses, before.lapses, 'a shown-then-played answer must not add a lapse');
  assert.equal(after.due, before.due, 'a shown-then-played answer must not move the due date');

  const readyAfter = await page.evaluate('window.__coach.state().ready');
  const judgedAfter = await page.evaluate('window.__coach.state().judged');
  const sessJudgedAfter = await page.evaluate('window.__coach.sess().judged');
  assert.equal(readyAfter, readyBefore, 'a help event must not move level progress');
  assert.equal(judgedAfter, judgedBefore, 'a help event must not count as a judged answer');
  assert.equal(sessJudgedAfter, sessJudgedBefore, 'a help event must not count toward the session judged total');

  const sessHelped = await page.evaluate('window.__coach.sess().helped');
  assert.equal(sessHelped, 1, 'the session help counter records the help event');
});

test('Show me: a later independent answer on the same item (no help) is graded normally', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const e = await driveToUnrevealed(page);
  await page.evaluate('window.__coach.showMe()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const before = await page.evaluate(`window.__coach.state().item['${e.id}']`);
  const judgedBefore = await page.evaluate('window.__coach.state().judged');

  // Drive fresh tasks (no help this time) until the same item comes up again
  // and answer it correctly without asking for help.
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    for (let k = 0; k < 12; k++) {
      const state = await page.evaluate(
        `(function () { const t = window.__coach.task(), c = window.__coach.cur();
          return { done: !!(t && t.done), id: c ? c.id : null, midi: c && c.info ? c.info.midi : null,
                   paused: !document.getElementById('breakCard').hidden }; })()`
      );
      if (state.paused) { await page.evaluate("document.getElementById('backBtn').click()"); continue; }
      if (state.done || state.midi === null) break;
      if (state.id === e.id) hit = true;
      await page.evaluate(`window.__coach.note(${state.midi}, true)`);
    }
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  }
  assert.ok(hit, `expected item ${e.id} to reappear within 60 tasks`);

  const after = await page.evaluate(`window.__coach.state().item['${e.id}']`);
  const judgedAfter = await page.evaluate('window.__coach.state().judged');
  assert.ok(after.stability > before.stability, `an unassisted correct answer must grow stability: before=${before.stability} after=${after.stability}`);
  assert.ok(judgedAfter > judgedBefore, 'an unassisted answer counts as a judged answer');
});
