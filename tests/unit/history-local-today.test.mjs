// app.js stamps every session with the LOCAL calendar day (today() reads
// getFullYear/getMonth/getDate). history.js must anchor "today" on that same
// local day, or an evening session west of Greenwich lands on "yesterday"
// and the streak, goal days and weekly report all read a day off.
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, ledger, weeklyReport } from '../../src/core/history.js';

// 21:00 on Tue 22 Sep 2026 in New York = 01:00 UTC on the 23rd.
const EVENING = new Date(2026, 8, 22, 21, 0, 0).getTime();
const log = [
  { d: '2026-09-21', mod: 'kbd', min: 20, acc: 0.9 },
  { d: '2026-09-22', mod: 'kbd', min: 20, acc: 0.9 },
];

test('the test really runs west of UTC, where local and UTC days differ at 9pm', () => {
  assert.equal(new Date(EVENING).toISOString().slice(0, 10), '2026-09-23');
});

test('an evening session counts toward today\'s streak', () => {
  assert.equal(summarize(log, { now: EVENING }).currentStreak, 2);
});

test('the practice ledger ends on the local today, with its goal met', () => {
  const l = ledger(log, { now: EVENING, weeks: 1, goalMin: 15 });
  const last = l.days[l.days.length - 1];
  assert.equal(last.day, '2026-09-22');
  assert.equal(last.metGoal, true);
  assert.equal(l.goalStreak, 2);
});

test('the weekly report window ends on the local today', () => {
  const r = weeklyReport({ sessions: log }, { now: EVENING });
  assert.equal(r.weekEnd, '2026-09-22');
  assert.equal(r.daysPractised, 2);
});
