// CURRENT BEHAVIOUR: answering correctly enough times on kbd raises
// state().ready to 1, and evaluate() (band-coach.html:386) then promotes
// state().level and resets ready to 0.2 — but only once every active item
// has n>=2 and m>=gate (the "hold" check), so a plain streak of rights can
// take more than one pass over the item pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = fileURLToPath(new URL('../../band-coach.html', import.meta.url));
const MAX_ANSWERS = 200;

test('answering correctly on kbd eventually levels up and resets ready to 0.2', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  let leveledUp = false;
  for (let i = 0; i < MAX_ANSWERS; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
    await page.waitFor('window.__coach.task().done', 5000);
    const level = await page.evaluate('window.__coach.state().level');
    if (level >= 2) {
      leveledUp = true;
      break;
    }
    // Wait for the next task to be built (0.7s after a clean task).
    await page.waitFor('!window.__coach.task().done', 5000);
  }

  assert.ok(leveledUp, `expected level >= 2 within ${MAX_ANSWERS} correct answers`);
  const ready = await page.evaluate('window.__coach.state().ready');
  assert.equal(ready, 0.2, 'ready resets to 0.2 on level-up');
});
