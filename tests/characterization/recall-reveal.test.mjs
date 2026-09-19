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
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
    await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);
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

// "Show me" (Unit 2.3, step 3): a visible, keyboard-operable button that
// reveals the current item on request and marks the task assisted so it
// cannot raise mastery — reusing the same e.failed path failEl() uses for a
// genuine miss (passEl() then forces e.q = 0, see src/app.js credit()).
test('Show me: reveals the current item and marks it assisted so mastery cannot go up', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const e = await driveToUnrevealed(page);
  const before = await page.evaluate(`window.__coach.state().item['${e.id}'].m`);

  await page.evaluate('window.__coach.showMe()');

  const afterReveal = await page.evaluate('window.__coach.cur()');
  assert.equal(afterReveal.reveal, true, 'showMe() reveals the current element');
  assert.equal(afterReveal.failed, true, 'showMe() marks the element failed so credit() cannot raise mastery');

  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.ok(hint.includes('String ' + e.info.string), 'the hint now shows the full answer once revealed');

  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  const after = await page.evaluate(`window.__coach.state().item['${e.id}'].m`);
  assert.ok(after <= before, `an assisted answer must not raise mastery: before=${before} after=${after}`);
});
