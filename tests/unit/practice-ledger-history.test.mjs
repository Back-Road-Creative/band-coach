import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledger, summarize, toTeacherSummary, SESSION_LOG_CAP } from '../../src/core/history.js';

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
  assert.equal(l.goalDays7, 0);
  assert.equal(l.goalDays28, 0);
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

test('ledger: goal days count days that hit the goal in the last 7 and 28 days, a gap is just a missed day', () => {
  const log = [sess(0, { min: 20 }), sess(1, { min: 20 }), sess(2, { min: 20 }), sess(4, { min: 20 }), sess(10, { min: 20 }), sess(20, { min: 5 })]; // gap at day 3; day 20 under goal
  const l = ledger(log, { now: NOW, weeks: 8, goalMin: 15 });
  assert.equal(l.goalDays7, 4);
  assert.equal(l.goalDays28, 5);
});

test('ledger: goal days do not need today or yesterday to have met the goal', () => {
  const log = [sess(2, { min: 20 }), sess(3, { min: 20 })];
  const l = ledger(log, { now: NOW, weeks: 1, goalMin: 15 });
  assert.equal(l.goalDays7, 2);
  assert.equal(l.goalDays28, 2);
});

test('ledger: goal days survive month and year boundaries', () => {
  const crossNow = Date.UTC(2027, 0, 1, 12, 0, 0); // Jan 1, 2027
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const log = [0, 1, 2, 5].map((o) => sess(0, { d: crossDay(o), min: 20 }));
  const l = ledger(log, { now: crossNow, weeks: 1, goalMin: 15 });
  assert.equal(l.goalDays7, 4);
});

test('summarize: practised days count the last 7 and 28 local days; a gap day is a missed day, never a reset', () => {
  const log = [sess(0), sess(1), sess(3), sess(4), sess(6), sess(6, { mod: 'gtr' }), sess(8), sess(27), sess(28), sess(40)];
  const s = summarize(log, { now: NOW });
  assert.equal(s.practisedLast7, 5, 'days 0,1,3,4,6 (two sessions on day 6 are one day)');
  assert.equal(s.practisedLast28, 7, 'adds day 8 and day 27; day 28 and 40 are outside the window');
  assert.equal(s.currentStreak, undefined);
  assert.equal(s.bestStreak, undefined);
});

test('summarize: practised days stay positive when today is silent or the last session was days ago', () => {
  assert.equal(summarize([sess(2), sess(3)], { now: NOW }).practisedLast7, 2);
  assert.equal(summarize([], { now: NOW }).practisedLast7, 0);
  assert.equal(summarize([], { now: NOW }).practisedLast28, 0);
});

test('summarize: practised days cross a year boundary', () => {
  const crossNow = Date.UTC(2027, 0, 1, 12, 0, 0);
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const s = summarize([0, 1, 2, 9].map((o) => sess(0, { d: crossDay(o) })), { now: crossNow });
  assert.equal(s.practisedLast7, 3);
  assert.equal(s.practisedLast28, 4);
});

test('toTeacherSummary: the report says practiced N of the last 7 and 28 days, with no streak wording', () => {
  const r = toTeacherSummary({ sessions: [sess(0), sess(2), sess(9)], mods: {} }, { now: NOW });
  assert.match(r.text, /Practiced 2 of the last 7 days, 3 of the last 28 days/);
  assert.match(r.html, /Practiced 2 of the last 7 days, 3 of the last 28 days/);
  assert.doesNotMatch(r.text + r.html, /streak/i);
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
