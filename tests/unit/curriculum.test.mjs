import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, describePlan, nextPlanStep } from '../../src/core/curriculum.js';
import { due } from '../../src/core/srs.js';

const DAY = 86400000;

function item({ stability = 10, lastSeen = 0, reps = 0, lapses = 0 } = {}) {
  return { stability, difficulty: 0.3, lastSeen, reps, lapses };
}

// ---------- planSession ----------

test('planSession: nothing due, no active ids -> no blocks', () => {
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: [], items: {}, now: 0, due });
  assert.deepEqual(blocks, []);
});

test('planSession: an overdue previously-seen item produces a review block', () => {
  const now = 100 * DAY;
  const items = { n60: item({ stability: 5, lastSeen: 0, reps: 3 }) };
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60'], items, now, due });
  const review = blocks.find(b => b.kind === 'review');
  assert.ok(review, 'expected a review block');
  assert.deepEqual(review.ids, ['n60']);
});

test('planSession: an id never reviewed before is never "due" for review', () => {
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60'], items: {}, now: 0, due });
  assert.equal(blocks.find(b => b.kind === 'review'), undefined);
});

test('planSession: weak picks the active id with a past lapse over one merely low on retrievability', () => {
  const now = 50 * DAY;
  const items = {
    G4: item({ stability: 5, lastSeen: 0, reps: 4, lapses: 1 }),
    A4: item({ stability: 1, lastSeen: 0, reps: 4, lapses: 0 })
  };
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['G4', 'A4'], items, now, due });
  const weak = blocks.find(b => b.kind === 'weak');
  assert.equal(weak.id, 'G4');
  assert.match(weak.why, /\S/);
});

test('planSession: with no lapsed active ids, weak falls back to the lowest-retrievability id', () => {
  const now = 50 * DAY;
  const items = {
    G4: item({ stability: 20, lastSeen: 0, reps: 4 }),
    A4: item({ stability: 1, lastSeen: 0, reps: 4 })
  };
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['G4', 'A4'], items, now, due });
  const weak = blocks.find(b => b.kind === 'weak');
  assert.equal(weak.id, 'A4');
});

test('planSession: review, weak, apply, check follow in order; apply names the weak id; check covers review+weak', () => {
  const now = 100 * DAY;
  const items = {
    n60: item({ stability: 5, lastSeen: 0, reps: 3 }),
    G4: item({ stability: 5, lastSeen: 0, reps: 4, lapses: 2 })
  };
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ['n60', 'G4'], items, now, due });
  assert.deepEqual(blocks.map(b => b.kind), ['review', 'weak', 'apply', 'check']);
  const apply = blocks.find(b => b.kind === 'apply');
  const weak = blocks.find(b => b.kind === 'weak');
  assert.equal(apply.skill, weak.id);
  const check = blocks.find(b => b.kind === 'check');
  assert.deepEqual(new Set(check.ids), new Set(['n60', 'G4']));
});

test('planSession: at most four blocks, however many ids are due', () => {
  const now = 100 * DAY;
  const items = {};
  const ids = [];
  for (let i = 0; i < 10; i++) { const id = 'n' + i; items[id] = item({ stability: 3, lastSeen: 0, reps: 3 }); ids.push(id); }
  const blocks = planSession({ instrumentId: 'kbd', level: 1, activeIds: ids, items, now, due });
  assert.ok(blocks.length <= 4, 'expected at most four blocks, got ' + blocks.length);
});

// ---------- describePlan ----------

test('describePlan: full plan reads as one plain sentence', () => {
  const blocks = [
    { kind: 'review', ids: ['a', 'b', 'c'] },
    { kind: 'weak', id: 'G4', why: 'slipped before' },
    { kind: 'apply', skill: 'G4' },
    { kind: 'check', ids: ['a', 'b', 'c', 'G4'] }
  ];
  assert.equal(describePlan(blocks), 'Today: 3 to review, then G4, then use it in a phrase, then a check.');
});

test('describePlan: review only', () => {
  const blocks = [{ kind: 'review', ids: ['a'] }];
  assert.equal(describePlan(blocks), 'Today: 1 to review.');
});

test('describePlan: nothing at all', () => {
  assert.equal(describePlan([]), 'Today: nothing new due -- free practice.');
});

test('describePlan: nameOf names the weak skill in plain words instead of its raw id', () => {
  const blocks = [
    { kind: 'weak', id: 'n67', why: 'the one practiced least so far' },
    { kind: 'apply', skill: 'n67' }
  ];
  const text = describePlan(blocks, id => (id === 'n67' ? 'G4' : id));
  assert.equal(text, 'Today: G4, then use it in a phrase.');
  assert.doesNotMatch(text, /\bn67\b/);
});

test('describePlan: no nameOf given falls back to the raw id, unchanged', () => {
  const blocks = [{ kind: 'weak', id: 'n67', why: 'x' }];
  assert.equal(describePlan(blocks), 'Today: n67.');
});

// ---------- nextPlanStep ----------

test('nextPlanStep: no blocks -> null', () => {
  assert.equal(nextPlanStep([], {}), null);
  assert.equal(nextPlanStep([], undefined), null);
});

test('nextPlanStep: review block serves one task per id, then hands off', () => {
  const blocks = [{ kind: 'review', ids: ['a', 'b'] }];
  assert.deepEqual(nextPlanStep(blocks, { review: 0 }), { kind: 'review', ids: ['a', 'b'], blind: false });
  assert.deepEqual(nextPlanStep(blocks, { review: 1 }), { kind: 'review', ids: ['a', 'b'], blind: false });
  assert.equal(nextPlanStep(blocks, { review: 2 }), null);
});

test('nextPlanStep: weak repeats its single id three times before moving on', () => {
  const blocks = [{ kind: 'weak', id: 'G4', why: 'x' }];
  assert.deepEqual(nextPlanStep(blocks, { weak: 0 }), { kind: 'weak', ids: ['G4'], blind: false });
  assert.deepEqual(nextPlanStep(blocks, { weak: 2 }), { kind: 'weak', ids: ['G4'], blind: false });
  assert.equal(nextPlanStep(blocks, { weak: 3 }), null);
});

test('nextPlanStep: apply gets two goes, named by skill', () => {
  const blocks = [{ kind: 'apply', skill: 'G4' }];
  assert.deepEqual(nextPlanStep(blocks, { apply: 0 }), { kind: 'apply', ids: ['G4'], blind: false });
  assert.deepEqual(nextPlanStep(blocks, { apply: 1 }), { kind: 'apply', ids: ['G4'], blind: false });
  assert.equal(nextPlanStep(blocks, { apply: 2 }), null);
});

test('nextPlanStep: check is blind and serves one task per id', () => {
  const blocks = [{ kind: 'check', ids: ['a', 'G4'] }];
  const step = nextPlanStep(blocks, { check: 0 });
  assert.deepEqual(step, { kind: 'check', ids: ['a', 'G4'], blind: true });
});

test('nextPlanStep: walks review -> weak -> apply -> check in order as each is exhausted', () => {
  const blocks = [
    { kind: 'review', ids: ['a'] },
    { kind: 'weak', id: 'G4', why: 'x' },
    { kind: 'apply', skill: 'G4' },
    { kind: 'check', ids: ['a', 'G4'] }
  ];
  assert.equal(nextPlanStep(blocks, { review: 0, weak: 0, apply: 0, check: 0 }).kind, 'review');
  assert.equal(nextPlanStep(blocks, { review: 1, weak: 0, apply: 0, check: 0 }).kind, 'weak');
  assert.equal(nextPlanStep(blocks, { review: 1, weak: 3, apply: 0, check: 0 }).kind, 'apply');
  assert.equal(nextPlanStep(blocks, { review: 1, weak: 3, apply: 2, check: 0 }).kind, 'check');
  assert.equal(nextPlanStep(blocks, { review: 1, weak: 3, apply: 2, check: 2 }), null);
});

test('nextPlanStep: a block the plan never produced (no review due) is skipped, not stuck', () => {
  const blocks = [
    { kind: 'weak', id: 'G4', why: 'x' },
    { kind: 'apply', skill: 'G4' },
    { kind: 'check', ids: ['G4'] }
  ];
  assert.equal(nextPlanStep(blocks, {}).kind, 'weak');
});
