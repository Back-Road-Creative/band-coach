// Practice calendar + daily minutes goal on the "My progress" panel
// (src/ui/history.js mount, backed by ledger() in src/core/history.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

async function seed(page) {
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    // The learner's LOCAL day, as app.js stamps sessions -- the UTC date is
    // already tomorrow on a US evening, which put this session off the week.
    const n = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    db.sessions = [
      { d: today, mod: 'kbd', min: 20, acc: 0.7, a1: 0.6, a2: 0.7, from: 1, to: 2, breaks: 0 },
      { d: '2026-09-10', mod: 'gtr', min: 5, acc: 0.5, a1: 0.4, a2: 0.5, from: 1, to: 1, breaks: 0 },
    ];
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
}

test('the history panel shows a practice calendar with shaded cells and screen-reader labels', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');

  const cellCount = await page.evaluate("document.querySelectorAll('.ledger-grid .ledger-cell').length");
  assert.equal(cellCount, 56); // default 8-week window

  const labelText = await page.evaluate("document.getElementById('historyCalendar').textContent");
  assert.match(labelText, /min, \d+ session/);

  const metClass = await page.evaluate("document.querySelectorAll('.ledger-cell-met').length");
  assert.ok(metClass >= 1, 'expected at least one day to show as goal-met (today, 20 min >= default 15)');
});

test('the daily minutes goal is editable, sanitized, and drives the goal streak line', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');

  const initial = await page.evaluate("document.getElementById('historyGoalInput').value");
  assert.equal(initial, '15');
  const initialStreak = await page.evaluate("document.getElementById('historyGoalStreak').textContent");
  assert.match(initialStreak, /Goal streak: 1 day/);

  await page.evaluate(`(function () {
    const input = document.getElementById('historyGoalInput');
    input.value = '9999';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const clamped = await page.evaluate("document.getElementById('historyGoalInput').value");
  assert.equal(clamped, '120');
  const streakAfterRaise = await page.evaluate("document.getElementById('historyGoalStreak').textContent");
  assert.match(streakAfterRaise, /No current goal streak yet/);
});

test('the goal is remembered across a reload via DB.panels.history', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  await page.evaluate(`(function () {
    const input = document.getElementById('historyGoalInput');
    input.value = '30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.waitFor("window.__coach.db().panels.history && window.__coach.db().panels.history.goalMin === 30", 5000);
  await page.waitFor("JSON.parse(localStorage.getItem('bandcoach.v1') || 'null')?.panels?.history?.goalMin === 30", 3000);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate("document.getElementById('historyGoalInput').value"), '30');
});

test('a new profile hides the empty "Look at items for" picker; practice brings it back', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate("document.getElementById('historyModSelect').closest('[hidden]') !== null || document.getElementById('historyModSelect').hidden"), true, 'no options, so no picker');
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  assert.equal(await page.evaluate("document.getElementById('historyModSelect').hidden"), false);
});

test('the calendar names its weekdays and says what the outline means', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  const heads = await page.evaluate("Array.from(document.querySelectorAll('.ledger-weekday')).map((e) => e.textContent)");
  assert.equal(heads.length, 7);
  const first = await page.evaluate("document.querySelector('.ledger-cell').title.slice(0, 10)");
  const wd = new Date(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10)).getDay();
  assert.equal(heads[0], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]);
  assert.match(await page.evaluate("document.getElementById('historyCalendar').textContent"), /outline/i);
  // the goal-met outline must not be the fill colour, or a full-shade cell hides it
  const same = await page.evaluate("(() => { const c = document.querySelector('.ledger-cell-met'); const s = getComputedStyle(c); return s.outlineColor === s.backgroundColor; })()");
  assert.equal(same, false);
});
