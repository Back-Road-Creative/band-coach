// P7-2 "journey acceptance": a learner routes to Practice, picks Keyboard,
// starts, answers enough exercises for the session to actually be logged,
// ends the session by keyboard, then routes to Progress and finds that
// session reflected there. axe-core confirms both stopping points -- the
// running Practice screen and Progress once a session exists -- stay
// WCAG-clean.
//
// F1 (plan §0.6): Progress renders only `summarize(db.sessions)` -- none of
// the §5 "retained / applied" labels appear anywhere in src/ui/history.js.
// This journey asserts only that a finished session shows up in Progress,
// never that retained/applied text appears.
//
// F3 (plan §0.6, src/app.js:1870 endSession(), re-grepped in this
// worktree): a session is only pushed onto DB.sessions when
// `sess.judged >= 8`, so the drive loop below must reach at least 8 judged
// answers before ending the session, or Progress would show nothing new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { axeSource, scan, tabTo } from '../helpers/journey.mjs';

const htmlPath = HTML_PATH;
const MAX_TASKS = 60;

// Same answer loop as tests/characterization/recall-reveal.test.mjs's
// driveToUnrevealed() (lines 24-45 there): answer every element of the
// current task, then wait for the next task to appear, until `sess.judged`
// reaches `minJudged`. A task's next task is started by the app itself once
// the current one reports done -- there is no separate "start next task"
// hook to call, so this loop only ever waits on `task().done` flipping and
// a fresh task appearing, exactly as the proven loop does.
async function driveUntilJudged(page, minJudged) {
  for (let i = 0; i < MAX_TASKS; i++) {
    if ((await page.evaluate('window.__coach.sess().judged')) >= minJudged) return;
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
    await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);
  }
  throw new Error(`sess.judged did not reach ${minJudged} within ${MAX_TASKS} tasks`);
}

// Reaches Practice's running state by keyboard alone, the same stops
// journey-first-visit.test.mjs proves: pick Keyboard from the instrument
// sheet, then Start.
async function startKeyboardPractice(page) {
  await tabTo(page, '#picker button[data-mod="kbd"]');
  await page.press('Enter');
  await page.waitFor("document.getElementById('picker').hidden === true");
  await tabTo(page, '#playBtn');
  await page.press('Enter');
  await page.waitFor('window.__coach.task()');
}

test('a finished Practice session appears in Progress', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Look at Progress before any practice happens, by the nav's own keyboard
  // route (routeTo('progress') -> openPanel('history')) so the recorded
  // "before" text is whatever the app itself renders, never a guess.
  await tabTo(page, '#mainNav button[data-route="progress"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  const summaryBefore = await page.evaluate("document.getElementById('historySummary').textContent");
  const sessionsBefore = await page.evaluate('window.__coach.db().sessions.length');

  // Back to Practice (routeTo('practice') -> closePanel()), pick Keyboard, Start.
  await tabTo(page, '#mainNav button[data-route="practice"]');
  await page.press('Enter');
  await startKeyboardPractice(page);

  // F3: nothing is logged below 8 judged answers.
  await driveUntilJudged(page, 8);
  assert.ok((await page.evaluate('window.__coach.sess().judged')) >= 8, 'drove at least 8 judged answers before ending');

  await tabTo(page, '#endBtn');
  await page.press('Enter');

  await tabTo(page, '#mainNav button[data-route="progress"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'history'");

  const summaryAfter = await page.evaluate("document.getElementById('historySummary').textContent");
  const sessionsAfter = await page.evaluate('window.__coach.db().sessions.length');

  assert.notEqual(summaryAfter, summaryBefore, '#historySummary should change once a session is logged');
  assert.equal(sessionsAfter, sessionsBefore + 1, 'db().sessions.length should go up by exactly one finished session');
});

test('axe is clean on Practice running and on Progress with a session', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate(axeSource);

  await startKeyboardPractice(page);
  await scan(page, 'Practice running');

  await driveUntilJudged(page, 8);
  await tabTo(page, '#endBtn');
  await page.press('Enter');

  await tabTo(page, '#mainNav button[data-route="progress"]');
  await page.press('Enter');
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  await scan(page, 'Progress with a session');
});
