// Session length choice E7c: the learner picks a session length (No limit /
// 5 / 10 / 15 minutes), saved in DB.prefs.sessionMinutes, and that choice
// sets sess.target when a drill session starts. tiredPattern()'s 15-minute
// cap (src/app.js's startSession) still wins, but only when it is lower than
// the learner's own choice. Real entry points (a select + change event, a
// click, a reload), not the __coach hook alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

function seedTiredSessions(n) {
  const sessions = [1, 2, 3].map(i => ({ d: '2020-01-0' + i, mod: 'kbd', min: 25, acc: 0.7, a1: 0.9, a2: 0.6, from: 1, to: 1, breaks: 0 }));
  return JSON.stringify({ v: 1, mods: {}, sessions, events: [], prefs: {} });
}

test('choosing 5 minutes sets the target and the break names 5 minutes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate(
    "const s = document.getElementById('optSessionMinutes'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true }));"
  );
  const savedPref = await page.evaluate('window.__coach.db().prefs.sessionMinutes');
  assert.equal(savedPref, 5);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const target = await page.evaluate('window.__coach.sess().target');
  assert.equal(target, 5);

  await page.evaluate('window.__coach.sess().active = 5 * 60 + 1');
  await page.waitFor('!document.getElementById("breakCard").hidden');

  const breakTitle = await page.evaluate("document.getElementById('breakTitle').textContent");
  assert.ok(breakTitle.includes('5 minutes'), `expected the break title to name 5 minutes, got: ${breakTitle}`);
  assert.ok(!breakTitle.includes('15'), `expected the break title not to mention 15, got: ${breakTitle}`);
  assert.deepEqual(page.exceptions, []);
});

test('the choice survives a reload and an invalid stored value becomes null', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate(
    "const s = document.getElementById('optSessionMinutes'); s.value = '10'; s.dispatchEvent(new Event('change', { bubbles: true }));"
  );

  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  const savedPref = await page.evaluate('window.__coach.db().prefs.sessionMinutes');
  assert.equal(savedPref, 10);
  const selValue = await page.evaluate("document.getElementById('optSessionMinutes').value");
  assert.equal(selValue, '10');

  const garbage = JSON.stringify({ v: 1, mods: {}, sessions: [], events: [], prefs: { sessionMinutes: 7 } });
  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(garbage)})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);

  const afterGarbage = await page.evaluate('window.__coach.db().prefs.sessionMinutes');
  assert.equal(afterGarbage, null);
});

test('the tired-pattern cap applies only when it is lower than the choice', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(`localStorage.setItem('bandcoach.v1', ${JSON.stringify(seedTiredSessions())})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const target1 = await page.evaluate('window.__coach.sess().target');
  assert.equal(target1, 15, 'expected the tired cap of 15 with no session-length choice made');

  await page.evaluate("document.getElementById('endBtn').click()");
  await page.evaluate(
    "const s = document.getElementById('optSessionMinutes'); s.value = '10'; s.dispatchEvent(new Event('change', { bubbles: true }));"
  );
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const target2 = await page.evaluate('window.__coach.sess().target');
  assert.equal(target2, 10, 'expected the lower choice of 10 to win over the tired cap of 15');
});
