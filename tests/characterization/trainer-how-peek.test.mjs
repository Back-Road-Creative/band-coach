// C1a: a "peek" beside the active note in the trainer itself -- the SAME
// Fingerings-panel diagram Songs' "How to play this" (C1b) already shows,
// but reached without leaving the drill. openPanel('fingerings') would work
// for the diagram, but its first line unconditionally calls endSession()
// (src/app.js), ending the running session and the current task -- so this
// button renders the diagram inline instead, the same way Songs does
// (src/ui/fingerings.js's renderHowInline), and never touches openPanel.
// Using it marks the current element helped, exactly like Show me (B3):
// help, not a failure, and it leaves a "shown" row in DB.events at credit
// time (tests/characterization/learning-events.test.mjs has the "shown"
// pattern for Show me; this is the same path via a different entry point).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { en } from '../../src/core/i18n.js';

const htmlPath = HTML_PATH;
const MAX_TASKS = 60;

// Same driveToUnrevealed pattern as tests/characterization/learning-events.test.mjs
// and recall-reveal.test.mjs: answers correctly until the current element is
// past its first two exposures (not revealed, not failed) -- the state a
// recall-style test, and this help path, actually needs.
async function driveToUnrevealed(page) {
  for (let i = 0; i < MAX_TASKS; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const e = await page.evaluate('window.__coach.cur()');
    if (e && e.reveal === false && !e.failed) return e;
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

test('peeking at "How to play this" shows the diagram inline, without ending the session, and logs assistance "shown"', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await driveToUnrevealed(page);

  // RED at base: no peek toggle exists in the trainer yet.
  await page.waitFor(
    `Array.from(document.querySelectorAll('#howPeekHost .how-inline-toggle')).some(b => b.textContent === ${JSON.stringify(en['howInline.button'])})`
  );
  const toggleSel = `Array.from(document.querySelectorAll('#howPeekHost .how-inline-toggle')).find(b => b.textContent === ${JSON.stringify(en['howInline.button'])})`;

  assert.equal(await page.evaluate(`(${toggleSel}).getAttribute('aria-expanded')`), 'false');
  await page.evaluate(`(${toggleSel}).click()`);

  assert.equal(await page.evaluate(`(${toggleSel}).getAttribute('aria-expanded')`), 'true');
  assert.equal(await page.evaluate("document.querySelector('#howPeekHost .how-inline-body').hidden"), false);
  const hits = await page.evaluate("document.querySelectorAll('#howPeekHost .fing-hit').length");
  assert.ok(hits > 0, 'the inline peek should draw at least one fing-hit for the current note');

  // Closing the peek (not the panel) leaves the running session and task
  // exactly as they were -- openPanel('fingerings') would have set both to
  // null via endSession().
  await page.evaluate(`(${toggleSel}).click()`);
  assert.equal(await page.evaluate("document.querySelector('#howPeekHost .how-inline-body').hidden"), true);
  assert.notEqual(await page.evaluate('window.__coach.sess()'), null);
  assert.notEqual(await page.evaluate('window.__coach.task()'), null);

  const afterPeek = await page.evaluate('window.__coach.cur()');
  assert.equal(afterPeek.helped, true, 'the peek marks the current element helped, like Show me');
  assert.equal(afterPeek.failed, false, 'the peek does not mark the element failed');

  const before = await page.evaluate('window.__coach.db().events.length');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.assistance, 'shown', 'a peeked-at element logs assistance "shown", the same as Show me');

  assert.deepEqual(page.exceptions, []);
});
