import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReport, SESSION_LOG_CAP } from '../../src/core/history.js';

const DAY = 86400000;
// 2026-09-19 12:00 UTC, a Saturday.
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const dayStr = (offsetDays) => new Date(NOW - offsetDays * DAY).toISOString().slice(0, 10);

const sess = (offsetDays, over) => ({
  d: dayStr(offsetDays),
  mod: 'kbd',
  min: 12,
  acc: 0.8,
  a1: 0.7,
  a2: 0.9,
  from: 1,
  to: 2,
  breaks: 0,
  ...over,
});

test('weeklyReport on an empty db reports an honest zero week, no fabricated numbers', () => {
  const w = weeklyReport({}, { now: NOW });
  assert.equal(w.totalMinutes, 0);
  assert.equal(w.daysPractised, 0);
  assert.equal(w.daysGoalMet, 0);
  assert.deepEqual(w.perInstrument, []);
  assert.equal(w.days.length, 7);
  assert.equal(w.truncated, false);
  assert.equal(w.name, 'This learner');
});

test('weeklyReport sums minutes and instrument breakdown across the last 7 days only', () => {
  const db = {
    sessions: [
      sess(0, { mod: 'kbd', min: 20 }),
      sess(1, { mod: 'gtr', min: 8 }),
      sess(6, { mod: 'kbd', min: 5 }),
      sess(10, { mod: 'kbd', min: 100 }), // outside the 7-day window
    ],
  };
  const w = weeklyReport(db, { now: NOW, goalMin: 15 });
  assert.equal(w.totalMinutes, 33); // 20 + 8 + 5, NOT the day-10 session
  assert.equal(w.daysPractised, 3);
  assert.equal(w.daysGoalMet, 1); // only the 20-min day meets the default-passed 15-min goal
  const kbd = w.perInstrument.find((m) => m.mod === 'kbd');
  const gtr = w.perInstrument.find((m) => m.mod === 'gtr');
  assert.equal(kbd.minutes, 25);
  assert.equal(kbd.sessions, 2);
  assert.equal(gtr.minutes, 8);
  assert.equal(gtr.sessions, 1);
});

test('weeklyReport uses a trimmed learnerName when given, and the honest default otherwise', () => {
  const db = { sessions: [sess(0, { min: 10 })] };
  const named = weeklyReport(db, { now: NOW, learnerName: '  Ada  ' });
  assert.equal(named.name, 'Ada');
  const unnamed = weeklyReport(db, { now: NOW, learnerName: '   ' });
  assert.equal(unnamed.name, 'This learner');
});

test('weeklyReport marks the week truncated (not a false zero) when the 60-session cap evicted days inside the window', () => {
  // 60 sessions, oldest kept at 3 days back — days 4, 5 and 6 in the 7-day
  // window fall before that and must be honestly unknown, not zero.
  const log = [];
  for (let i = 0; i < SESSION_LOG_CAP; i++) log.push(sess(i % 4, { min: 1 }));
  const oldestKeptDay = dayStr(3);
  const w = weeklyReport({ sessions: log }, { now: NOW });
  assert.equal(w.truncated, true);
  const day5 = w.days.find((d) => d.day === dayStr(5));
  assert.equal(day5.notKept, true);
  assert.equal(day5.minutes, 0);
  const day2 = w.days.find((d) => d.day === dayStr(2));
  assert.equal(day2.notKept, false);
  assert.ok(dayStr(2) >= oldestKeptDay);
});
