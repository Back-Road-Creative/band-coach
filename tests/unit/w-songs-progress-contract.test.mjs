// Song practice progress contract (fix/song-progress-contract):
//  - applyMasteryCredit() (src/ui/songs.js) writes the SAME live SRS item
//    shape src/app.js's built-in drills write via src/core/srs.js's
//    review(), not the old { m, n, last, seen } shape, and migrates an
//    old-shape record forward instead of discarding it.
//  - creditFor() (src/song/lesson.js) is covered separately in
//    tests/unit/lesson-gen.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMasteryCredit, summarizePracticeSession } from '../../src/ui/songs.js';
import { migrateItem } from '../../src/core/srs.js';

function fakeApi(db) {
  return { db: () => db, save: () => {} };
}

test('applyMasteryCredit writes the live item shape (stability/difficulty/lastSeen/reps/lapses), not { m, n }', () => {
  const db = { mods: {} };
  applyMasteryCredit(fakeApi(db), 'violin', [{ id: 'p4', hit: true }]);
  const item = db.mods.violin.item.p4;
  assert.equal(typeof item.stability, 'number');
  assert.equal(typeof item.difficulty, 'number');
  assert.equal(typeof item.lastSeen, 'number');
  assert.equal(item.reps, 1);
  assert.equal(item.lapses, 0);
  assert.equal(item.m, undefined);
  assert.equal(item.n, undefined);
});

test('applyMasteryCredit grows stability on a hit and shrinks it on a miss (via srs review, not a hand-rolled average)', () => {
  const db = { mods: {} };
  applyMasteryCredit(fakeApi(db), 'violin', [{ id: 'p4', hit: true }]);
  const afterHit = db.mods.violin.item.p4.stability;
  applyMasteryCredit(fakeApi(db), 'violin', [{ id: 'p4', hit: false }]);
  const afterMiss = db.mods.violin.item.p4.stability;
  assert.ok(afterMiss < afterHit, 'a lapse should shrink stability: ' + afterHit + ' -> ' + afterMiss);
  assert.equal(db.mods.violin.item.p4.lapses, 1);
});

test('applyMasteryCredit migrates an existing old-shape { m, n, last } record forward instead of discarding its progress', () => {
  const now = Date.now();
  const oldItem = { m: 0.9, n: 12, last: now, seen: 7 };
  const db = { mods: { violin: { item: { p4: oldItem } } } };
  applyMasteryCredit(fakeApi(db), 'violin', [{ id: 'p4', hit: true }]);
  const item = db.mods.violin.item.p4;
  // A record that had mastery 0.9 (well above the default 0.4/0.3
  // difficulty) should migrate to a low difficulty, not reset to the
  // brand-new-item default -- proves migrateItem(), not a fresh item, fed
  // review().
  const migrated = migrateItem(oldItem, now);
  assert.ok(item.difficulty < 0.3, 'expected the migrated low difficulty (from mastery 0.9), got ' + item.difficulty);
  assert.ok(item.stability > migrated.stability, 'a hit should grow stability past the freshly-migrated starting point: ' + migrated.stability + ' -> ' + item.stability);
  assert.equal(item.seen, 7, 'seen (a UI/app.js-owned counter) is preserved through the migration');
});

test('applyMasteryCredit preserves an already-live-shape item instead of re-migrating it as if it were old-shape', () => {
  const db = { mods: { violin: { item: { p4: { stability: 40, difficulty: 0.1, lastSeen: Date.now() - 86400000, reps: 5, lapses: 0, seen: 3 } } } } };
  applyMasteryCredit(fakeApi(db), 'violin', [{ id: 'p4', hit: true }]);
  const item = db.mods.violin.item.p4;
  assert.equal(item.reps, 6);
  assert.ok(item.stability > 40, 'a hit on an already-strong item should grow it further, not reset to the default 10-day stability');
});

test('summarizePracticeSession returns null when no step has been judged yet', () => {
  assert.equal(summarizePracticeSession({ instrumentId: 'kbd', song: { id: 's1' } }, 100), null);
  assert.equal(summarizePracticeSession(null, 100), null);
});

test('summarizePracticeSession summarizes minutes and accuracy from the judged-step counters', () => {
  const practice = { instrumentId: 'gtr', song: { id: 'song-9' }, startedAt: 100, judgedCount: 4, judgedOk: 3 };
  const summary = summarizePracticeSession(practice, 100 + 120);
  assert.equal(summary.mod, 'gtr');
  assert.equal(summary.songId, 'song-9');
  assert.equal(summary.source, 'song');
  assert.equal(summary.minutes, 2);
  assert.equal(summary.acc, 0.75);
});

test('summarizePracticeSession never returns a negative minutes value', () => {
  const practice = { instrumentId: 'kbd', song: { id: 's1' }, startedAt: 500, judgedCount: 1, judgedOk: 1 };
  const summary = summarizePracticeSession(practice, 10);
  assert.equal(summary.minutes, 0);
});
