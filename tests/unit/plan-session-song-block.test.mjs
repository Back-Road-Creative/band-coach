import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, describePlan, nextPlanStep } from '../../src/core/curriculum.js';
import { due } from '../../src/core/srs.js';

const DAY = 86400000;

function item({ stability = 10, lastSeen = 0, reps = 0, lapses = 0 } = {}) {
  return { stability, difficulty: 0.3, lastSeen, reps, lapses };
}

const songFor = () => ({ songId: 'hot-cross-buns', title: 'Hot Cross Buns' });
const TODAY = '2026-09-27';

test('planSession: a kbd songFor appends a song block as the last block', () => {
  const now = 100 * DAY;
  const items = { n60: item({ stability: 5, lastSeen: 0, reps: 3 }) };
  const withSong = planSession({ instrumentId: 'kbd', level: 2, activeIds: ['n60'], items, now, due, sessions: [], today: TODAY, songFor });
  const withoutSong = planSession({ instrumentId: 'kbd', level: 2, activeIds: ['n60'], items, now, due, sessions: [], today: TODAY });
  const last = withSong[withSong.length - 1];
  assert.deepEqual(last, { kind: 'song', songId: 'hot-cross-buns', title: 'Hot Cross Buns', done: false });
  assert.deepEqual(withSong.slice(0, 4), withoutSong.slice(0, 4));
  assert.equal(withoutSong.find(b => b.kind === 'song'), undefined);
});

test('planSession: song block done is true only for a matching sessions row logged today', () => {
  const now = 100 * DAY;
  const items = { n60: item({ stability: 5, lastSeen: 0, reps: 3 }) };
  const base = { instrumentId: 'kbd', level: 2, activeIds: ['n60'], items, now, due, today: TODAY, songFor };
  const matchRow = [{ d: TODAY, mod: 'kbd', source: 'song', songId: 'hot-cross-buns' }];
  const wrongDay = [{ d: '2026-09-26', mod: 'kbd', source: 'song', songId: 'hot-cross-buns' }];
  const wrongSong = [{ d: TODAY, mod: 'kbd', source: 'song', songId: 'mary-had-a-little-lamb' }];
  const wrongMod = [{ d: TODAY, mod: 'gtr', source: 'song', songId: 'hot-cross-buns' }];
  assert.equal(planSession({ ...base, sessions: matchRow }).find(b => b.kind === 'song').done, true);
  assert.equal(planSession({ ...base, sessions: wrongDay }).find(b => b.kind === 'song').done, false);
  assert.equal(planSession({ ...base, sessions: wrongSong }).find(b => b.kind === 'song').done, false);
  assert.equal(planSession({ ...base, sessions: wrongMod }).find(b => b.kind === 'song').done, false);
});

test('planSession: with no item records at all, a song block still appears alone', () => {
  const blocks = planSession({ instrumentId: 'kbd', level: 2, activeIds: [], items: {}, now: 0, due, sessions: [], today: TODAY, songFor });
  assert.deepEqual(blocks, [{ kind: 'song', songId: 'hot-cross-buns', title: 'Hot Cross Buns', done: false }]);
});

test('describePlan: a song block appends "then play <title>" or reads alone', () => {
  const now = 100 * DAY;
  const items = { n60: item({ stability: 5, lastSeen: 0, reps: 3 }) };
  const withSong = planSession({ instrumentId: 'kbd', level: 2, activeIds: ['n60'], items, now, due, sessions: [], today: TODAY, songFor });
  assert.equal(describePlan(withSong), 'Today: 1 to review, then n60, then use it in a phrase, then a check, then play Hot Cross Buns.');
  const songOnly = planSession({ instrumentId: 'kbd', level: 2, activeIds: [], items: {}, now: 0, due, sessions: [], today: TODAY, songFor });
  assert.equal(describePlan(songOnly), 'Today: play Hot Cross Buns.');
  const done = planSession({ instrumentId: 'kbd', level: 2, activeIds: ['n60'], items, now, due, today: TODAY, songFor, sessions: [{ d: TODAY, mod: 'kbd', source: 'song', songId: 'hot-cross-buns' }] });
  assert.match(describePlan(done), /play Hot Cross Buns \(done today\)/);
});

test('planSession: unchanged when no songFor/sessions/today are passed', () => {
  const now = 100 * DAY;
  const items = {
    n60: item({ stability: 5, lastSeen: 0, reps: 3 }),
    G4: item({ stability: 5, lastSeen: 0, reps: 4, lapses: 2 })
  };
  const withExtras = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60', 'G4'], items, now, due });
  const withoutExtras = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60', 'G4'], items, now, due });
  assert.deepEqual(withExtras, withoutExtras);
});

test('nextPlanStep: a song block is never served as a drill', () => {
  const blocks = [
    { kind: 'review', ids: ['a'] },
    { kind: 'weak', id: 'G4', why: 'x' },
    { kind: 'apply', skill: 'G4' },
    { kind: 'check', ids: ['a', 'G4'] },
    { kind: 'song', songId: 'hot-cross-buns', title: 'Hot Cross Buns', done: false }
  ];
  assert.equal(nextPlanStep(blocks, { review: 1, weak: 3, apply: 2, check: 2 }), null);
});
