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

// The plan names the weak skill in plain words (info(mod, id, prefs).short,
// e.g. "G4"), never a raw internal id like 'n67' -- a learner has no reason
// to know that spelling.
test('the coach line names the weak skill in plain words, never a raw id', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.item = { n60: { stability: 5, difficulty: 0.3, lastSeen: Date.now() - 100 * 86400000, reps: 4, lapses: 1, seen: 5 } };
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.doesNotMatch(coachText, /\bn\d{2}\b/, `expected no raw id in the coach line, got: ${coachText}`);
  // n60's plain name (info('kbd', 'n60', prefs).short) is a letter name --
  // "C" -- the seeded item is the only active/seen id, so it is both the
  // weak pick and the one the coach line must name in plain words.
  assert.match(coachText, /then [A-G](#|b)?,/, `expected the plain name of the weak skill in the coach line, got: ${coachText}`);
});
