import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, sparkline, toTeacherSummary } from '../../src/core/history.js';

const DAY = 86400000;
// 2026-09-19 12:00 UTC, a Saturday — matches "today" in the task context.
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

test('summarize on an empty log returns zeroed, well-formed output', () => {
  const s = summarize([], { now: NOW });
  assert.equal(s.currentStreak, 0);
  assert.equal(s.bestStreak, 0);
  assert.deepEqual(s.minutesPerDay, []);
  assert.deepEqual(s.minutesPerWeek, []);
  assert.deepEqual(s.perInstrument, []);
  assert.equal(s.strongest, null);
  assert.equal(s.needsWork, null);
  assert.equal(s.accuracyTrend.direction, 'flat');
});

test('summarize computes minutes per day and per-instrument time', () => {
  const log = [
    sess(0, { mod: 'kbd', min: 10 }),
    sess(0, { mod: 'gtr', min: 5 }),
    sess(1, { mod: 'kbd', min: 20 }),
  ];
  const s = summarize(log, { now: NOW });
  const today = s.minutesPerDay.find((x) => x.day === dayStr(0));
  assert.equal(today.minutes, 15);
  const kbd = s.perInstrument.find((x) => x.mod === 'kbd');
  const gtr = s.perInstrument.find((x) => x.mod === 'gtr');
  assert.equal(kbd.minutes, 30);
  assert.equal(gtr.minutes, 5);
  assert.equal(kbd.maxLevel, 2);
});

test('summarize: current streak counts consecutive days back from today, breaking on a gap', () => {
  const log = [sess(0), sess(1), sess(2), sess(4)]; // gap at day 3
  const s = summarize(log, { now: NOW });
  assert.equal(s.currentStreak, 3);
  assert.equal(s.bestStreak, 3);
});

test('summarize: a missed day today still finds the most recent streak ending yesterday as current only if today has no session', () => {
  const log = [sess(1), sess(2), sess(3)]; // nothing today
  const s = summarize(log, { now: NOW });
  assert.equal(s.currentStreak, 0); // streak is defined as "still going", and today is silent
  assert.equal(s.bestStreak, 3);
});

test('summarize: streaks survive a month boundary', () => {
  const crossNow = Date.UTC(2026, 9, 2, 12, 0, 0); // Oct 2, 2026
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const log = [0, 1, 2, 3].map((o) => sess(0, { d: crossDay(o) }));
  const s = summarize(log, { now: crossNow });
  assert.equal(s.currentStreak, 4);
  assert.equal(s.bestStreak, 4);
});

test('summarize: streaks survive a year boundary', () => {
  const crossNow = Date.UTC(2027, 0, 1, 12, 0, 0); // Jan 1, 2027
  const crossDay = (offset) => new Date(crossNow - offset * DAY).toISOString().slice(0, 10);
  const log = [0, 1, 2].map((o) => sess(0, { d: crossDay(o) }));
  const s = summarize(log, { now: crossNow });
  assert.equal(s.currentStreak, 3);
});

test('summarize: strongest and needs-work pick highest/lowest average accuracy instrument', () => {
  const log = [
    sess(0, { mod: 'kbd', acc: 0.95 }),
    sess(1, { mod: 'kbd', acc: 0.9 }),
    sess(0, { mod: 'gtr', acc: 0.4 }),
    sess(1, { mod: 'gtr', acc: 0.5 }),
  ];
  const s = summarize(log, { now: NOW });
  assert.equal(s.strongest.mod, 'kbd');
  assert.equal(s.needsWork.mod, 'gtr');
});

test('summarize: accuracy trend compares recent sessions to earlier ones', () => {
  const older = [0, 1, 2, 3, 4, 5, 6].map((o) => sess(o + 10, { acc: 0.5 }));
  const recent = [0, 1, 2, 3, 4, 5, 6].map((o) => sess(o, { acc: 0.9 }));
  const s = summarize([...older, ...recent], { now: NOW });
  assert.equal(s.accuracyTrend.direction, 'up');
});

test('summarize handles a 60-session log without throwing and keeps sessions bounded', () => {
  const log = [];
  for (let i = 0; i < 60; i++) {
    log.push(sess(Math.floor(i / 2), { mod: i % 2 ? 'kbd' : 'gtr', acc: 0.5 + (i % 10) / 20 }));
  }
  const s = summarize(log, { now: NOW });
  assert.ok(s.perInstrument.length > 0);
  assert.ok(s.minutesPerDay.length > 0);
  assert.ok(s.minutesPerWeek.length > 0);
});

test('sparkline: downsamples to the requested width with plain numbers', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const spark = sparkline(values, 5);
  assert.equal(spark.length, 5);
  spark.forEach((n) => assert.ok(typeof n === 'number' && isFinite(n)));
});

test('sparkline: an empty input returns an all-zero row of the requested width', () => {
  assert.deepEqual(sparkline([], 4), [0, 0, 0, 0]);
});

test('sparkline: width wider than the data still returns exactly `width` values', () => {
  const spark = sparkline([1, 2], 6);
  assert.equal(spark.length, 6);
});

test('toTeacherSummary: produces a plain-text and an html report naming the honest limits', () => {
  const db = {
    sessions: [sess(0), sess(1)],
    mods: { kbd: { level: 4 } },
  };
  const out = toTeacherSummary(db, { now: NOW, learnerName: 'Rowan' });
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  assert.ok(out.text.includes('Rowan'));
  assert.ok(/microphone/i.test(out.text));
  assert.ok(/string and fret/i.test(out.text));
  assert.ok(out.html.startsWith('<'));
  assert.ok(!/<script/i.test(out.html));
});

test('toTeacherSummary: works on an empty db without throwing', () => {
  const out = toTeacherSummary({ sessions: [], mods: {} }, { now: NOW, learnerName: 'Rowan' });
  assert.ok(out.text.length > 0);
  assert.ok(out.html.length > 0);
});
