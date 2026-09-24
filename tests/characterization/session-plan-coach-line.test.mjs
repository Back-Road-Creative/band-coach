// startSession (src/app.js) now appends src/core/curriculum.js's describePlan()
// to the coach line, so a learner sees what today's sitting will cover, not
// just the level number. Real entry point (a click), not the __coach hook,
// so this proves the shipped coach line actually changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

test('starting a session names today\'s plan in the coach line', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(coachText, /Today:/, `expected the coach line to name today's plan, got: ${coachText}`);
});
