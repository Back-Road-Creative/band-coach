import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledger, SESSION_LOG_CAP } from '../../src/core/history.js';

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

test('ledger on an empty log returns a full window of zeroed, present days', () => {
  const l = ledger([], { now: NOW, weeks: 8 });
  assert.equal(l.days.length, 56);
  assert.equal(l.days[0].day, dayStr(55));
  assert.equal(l.days[l.days.length - 1].day, dayStr(0));
  l.days.forEach((d) => {
    assert.equal(d.minutes, 0);
    assert.equal(d.sessions, 0);
    assert.equal(d.levelChange, 0);
    assert.equal(d.metGoal, false);
    assert.equal(d.notKept, false);
  });
  assert.equal(l.goalStreak, 0);
});

test('ledger sums minutes, session counts and level deltas per day, leaving gap days at zero', () => {
  const log = [
    sess(0, { min: 10, from: 3, to: 4 }),
    sess(0, { mod: 'gtr', min: 5, from: 1, to: 1 }),
    sess(2, { min: 20, from: 4, to: 6 }),
  ];
  const l = ledger(log, { now: NOW, weeks: 2 });
  const today = l.days.find((d) => d.day === dayStr(0));
  const gapDay = l.days.find((d) => d.day === dayStr(1));
  const older = l.days.find((d) => d.day === dayStr(2));
  assert.equal(today.minutes, 15);
  assert.equal(today.sessions, 2);
  assert.equal(today.levelChange, 1); // (4-3) + (1-1)
  assert.equal(gapDay.minutes, 0);
  assert.equal(gapDay.sessions, 0);
  assert.equal(older.minutes, 20);
  assert.equal(older.levelChange, 2);
});

test('ledger: a goal is met when the day\'s total minutes reach goalMin', () => {
  const log = [sess(0, { min: 14 }), sess(1, { min: 16 })];
  const l = ledger(log, { now: NOW, weeks: 1, goalMin: 15 });
  assert.equal(l.days.find((d) => d.day === dayStr(0)).metGoal, false);
  assert.equal(l.days.find((d) => d.day === dayStr(1)).metGoal, true);
});

test('ledger: goal streak counts consecutive met days ending today', () => {
  const log = [sess(0, { min: 20 }), sess(1, { min: 20 }), sess(2, { min: 20 }), sess(4, { min: 20 })]; // gap at day 3
  const l = ledger(log, { now: NOW, weeks: 1, goalMin: 15 });
  assert.equal(l.goalStreak, 3);
});

test('ledger: goal streak still counts through yesterday when today has no session yet', () => {
  const log = [sess(1, { min: 20 }), sess(2, { min: 20 }), sess(3, { min: 20 })]; // nothing today
  const l = ledger(log, { now: NOW, weeks: 1, goalMin: 15 });
  assert.equal(l.goalStreak, 3);
});

test('ledger: goal streak is zero when neither today nor yesterday met the goal', () => {
  const log = [sess(2, { min: 20 }), sess(3, { min: 20 })]; // nothing today or yesterday
  const l = ledger(log, { now: NOW, weeks: 1, goalMin: 15 });
  assert.equal(l.goalStreak, 0);
});

test('ledger: streaks survive a month boundary', () => {
  const crossNow = Date.UTC(2026, 9, 2, 12, 0, 0); // Oct 2, 2026
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const log = [0, 1, 2, 3].map((o) => sess(0, { d: crossDay(o), min: 20 }));
  const l = ledger(log, { now: crossNow, weeks: 1, goalMin: 15 });
  assert.equal(l.goalStreak, 4);
});

test('ledger: streaks survive a year boundary', () => {
  const crossNow = Date.UTC(2027, 0, 1, 12, 0, 0); // Jan 1, 2027
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const log = [0, 1, 2].map((o) => sess(0, { d: crossDay(o), min: 20 }));
  const l = ledger(log, { now: crossNow, weeks: 1, goalMin: 15 });
  assert.equal(l.goalStreak, 3);
});

test('ledger: the 60-cap edge — when the log is full and its oldest kept day falls inside the window, earlier days are marked not-kept, never a false zero', () => {
  // 60 sessions, one every other day, most recent is today: oldest kept day is 118 days back.
  const log = [];
  for (let i = 0; i < SESSION_LOG_CAP; i++) log.push(sess(i * 2, { min: 10 }));
  assert.equal(log.length, 60);
  // A wide window (26 weeks = 182 days) reaches back further than the oldest kept session.
  const l = ledger(log, { now: NOW, weeks: 26 });
  const oldestKeptDay = dayStr(2 * (SESSION_LOG_CAP - 1));
  const beforeOldest = l.days.find((d) => d.day < oldestKeptDay);
  assert.ok(beforeOldest, 'expected at least one day older than the oldest kept session in the window');
  assert.equal(beforeOldest.notKept, true);
  assert.equal(beforeOldest.metGoal, false);
  const atOldest = l.days.find((d) => d.day === oldestKeptDay);
  assert.equal(atOldest.notKept, false);
  assert.equal(l.truncated, true);
});

test('ledger: an under-cap log with an old start is NOT flagged not-kept (no sessions were ever evicted)', () => {
  const log = [sess(40, { min: 10 })]; // just one, far in the past, well under the cap
  const l = ledger(log, { now: NOW, weeks: 8 });
  const day40 = l.days.find((d) => d.day === dayStr(40));
  assert.equal(day40.notKept, false);
  assert.equal(day40.minutes, 10);
  assert.equal(l.truncated, false);
});

test('ledger defaults to an 8-week window and a 15-minute goal', () => {
  const l = ledger([sess(0, { min: 15 })], { now: NOW });
  assert.equal(l.days.length, 56);
  assert.equal(l.goalMin, 15);
});
