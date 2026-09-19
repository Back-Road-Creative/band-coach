import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE,
  DEFAULT_STABILITY_DAYS,
  MIN_STABILITY_DAYS,
  retrievability,
  review,
  due,
  migrateItem,
} from '../../src/core/srs.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;

test('retrievability is 1 right at lastSeen and decays with days', () => {
  const item = { stability: 10, lastSeen: NOW };
  assert.equal(retrievability(item, NOW), 1);
  const r10 = retrievability(item, NOW + 10 * DAY);
  assert.ok(Math.abs(r10 - 0.5) < 1e-9, `expected ~0.5 at one half-life, got ${r10}`);
  const r20 = retrievability(item, NOW + 20 * DAY);
  assert.ok(Math.abs(r20 - 0.25) < 1e-9, `expected ~0.25 at two half-lives, got ${r20}`);
});

test('retrievability never exceeds 1 and never goes below 0', () => {
  const item = { stability: 5, lastSeen: NOW };
  assert.equal(retrievability(item, NOW - DAY), 1); // reviewed "in the future" relative to now: clamp
  assert.ok(retrievability(item, NOW + 10000 * DAY) >= 0);
});

test('review: a lapse halves stability and raises difficulty, never below the floor', () => {
  const item = { stability: 4, difficulty: 0.3, lastSeen: NOW, reps: 3, lapses: 0 };
  const out = review(item, { grade: GRADE.LAPSE, now: NOW + 2 * DAY });
  assert.equal(out.stability, 2);
  assert.ok(out.difficulty > 0.3);
  assert.equal(out.lapses, 1);
  assert.equal(out.reps, 3); // a lapse does not count as a successful rep
  assert.equal(out.lastSeen, NOW + 2 * DAY);

  const tiny = { stability: MIN_STABILITY_DAYS, difficulty: 0.9, lastSeen: NOW, reps: 0, lapses: 0 };
  const outTiny = review(tiny, { grade: GRADE.LAPSE, now: NOW + DAY });
  assert.ok(outTiny.stability >= MIN_STABILITY_DAYS);
});

test('review: success grows stability and increments reps', () => {
  const item = { stability: 10, difficulty: 0.3, lastSeen: NOW, reps: 2, lapses: 0 };
  const out = review(item, { grade: GRADE.GOOD, now: NOW + 10 * DAY });
  assert.ok(out.stability > item.stability, 'stability should grow on a successful review');
  assert.equal(out.reps, 3);
  assert.equal(out.lapses, 0);
});

test('review: hard-but-right after a long gap grows stability more than an easy review right on schedule', () => {
  const base = { stability: 10, difficulty: 0.3, lastSeen: NOW, reps: 5, lapses: 0 };
  const hardLongGap = review(base, { grade: GRADE.HARD, now: NOW + 30 * DAY });
  const easyOnTime = review(base, { grade: GRADE.EASY, now: NOW + 1 * DAY });
  assert.ok(
    hardLongGap.stability > easyOnTime.stability,
    `expected hard-but-right-after-long-gap (${hardLongGap.stability}) to beat easy-right-on-schedule (${easyOnTime.stability})`
  );
});

test('review: easy grade lowers difficulty, hard grade raises it', () => {
  const item = { stability: 10, difficulty: 0.5, lastSeen: NOW, reps: 1, lapses: 0 };
  const easy = review(item, { grade: GRADE.EASY, now: NOW + DAY });
  const hard = review(item, { grade: GRADE.HARD, now: NOW + DAY });
  assert.ok(easy.difficulty < item.difficulty);
  assert.ok(hard.difficulty > item.difficulty);
});

test('due: orders items most-forgotten (lowest retrievability) first', () => {
  const items = [
    { id: 'fresh', stability: 10, lastSeen: NOW }, // r = 1
    { id: 'stale', stability: 5, lastSeen: NOW - 20 * DAY }, // r = 0.0625
    { id: 'mid', stability: 10, lastSeen: NOW - 10 * DAY }, // r = 0.5
  ];
  const ordered = due(items, NOW, { target: 0.85 });
  assert.deepEqual(ordered.map((x) => x.id), ['stale', 'mid', 'fresh']);
  assert.equal(ordered[0].overdue, true);
  assert.equal(ordered[2].overdue, false);
});

test('due: ties break deterministically by id', () => {
  const items = [
    { id: 'b', stability: 10, lastSeen: NOW },
    { id: 'a', stability: 10, lastSeen: NOW },
  ];
  assert.deepEqual(due(items, NOW).map((x) => x.id), ['a', 'b']);
});

test('due: on an empty list returns an empty list', () => {
  assert.deepEqual(due([], NOW), []);
  assert.deepEqual(due(undefined, NOW), []);
});

test('migrateItem: retrievability right after migration equals the old flat-half-life formula, never-reviewed item', () => {
  const oldItem = { m: 0.62, n: 3, last: 0, seen: 8 };
  const migrated = migrateItem(oldItem, NOW);
  assert.ok(Math.abs(retrievability(migrated, NOW) - 0.62) < 1e-9);
  assert.equal(migrated.reps, 3);
  assert.equal(migrated.lapses, 0);
});

test('migrateItem: retrievability right after migration matches legacy decay for a reviewed item', () => {
  const last = NOW - 25 * DAY;
  const oldItem = { m: 0.8, n: 10, last, seen: 40 };
  // legacy formula: 0.4 + (0.8 - 0.4) * 0.5^(25/10)
  const expected = 0.4 + (0.8 - 0.4) * Math.pow(0.5, 25 / 10);
  const migrated = migrateItem(oldItem, NOW);
  const got = retrievability(migrated, NOW);
  assert.ok(Math.abs(got - expected) < 1e-9, `expected ${expected}, got ${got}`);
});

test('migrateItem: a weak, long-neglected item still migrates to a valid, finite state', () => {
  const oldItem = { m: 0.05, n: 1, last: NOW - 400 * DAY, seen: 2 };
  const migrated = migrateItem(oldItem, NOW);
  assert.ok(isFinite(migrated.lastSeen));
  assert.ok(migrated.stability > 0);
  const r = retrievability(migrated, NOW);
  assert.ok(r >= 0 && r <= 1 && isFinite(r));
});

test('migrateItem: default stability is the same as the old fixed half-life, until the next review', () => {
  const migrated = migrateItem({ m: 0.4, n: 0, last: 0, seen: 0 }, NOW);
  assert.equal(migrated.stability, DEFAULT_STABILITY_DAYS);
});
