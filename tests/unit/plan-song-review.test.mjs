// F5: a song review queued in an earlier session (src/core/teaching.js
// addReview, src/ui/songs.js) leads today's plan, so the learner sees it
// before Songs is ever opened. planSession takes the due reviews as
// `songReviews`; describePlan names the first one; nextPlanStep never serves
// it as a drill task (the Songs panel plays it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, describePlan, nextPlanStep } from '../../src/core/curriculum.js';
import { due } from '../../src/core/srs.js';

const DAY = 86400000;
const item = () => ({ stability: 5, difficulty: 0.3, lastSeen: 0, reps: 3, lapses: 0 });
const base = { instrumentId: 'kbd', level: 2, activeIds: ['n60'], items: { n60: item() }, now: 100 * DAY, due, sessions: [], today: '2026-10-25' };
const hcb = { songId: 'hot-cross-buns', partId: 'melody', title: 'Hot Cross Buns', bars: [2, 3] };

test('planSession: a due song review is the first block, and the rest of the plan is unchanged', () => {
  const plain = planSession(base);
  const withReview = planSession({ ...base, songReviews: [hcb, { ...hcb, songId: 'london-bridge', title: 'London Bridge' }] });
  assert.deepEqual(withReview[0], { kind: 'songReview', songId: 'hot-cross-buns', partId: 'melody', title: 'Hot Cross Buns', bars: [2, 3] });
  assert.deepEqual(withReview.slice(1), plain, 'only one review block, ahead of the drill blocks');
});

test('planSession: no reviews, or ones without a title or bars, add nothing', () => {
  const plain = planSession(base);
  assert.deepEqual(planSession({ ...base, songReviews: [] }), plain);
  assert.deepEqual(planSession({ ...base, songReviews: 'x' }), plain);
  assert.deepEqual(planSession({ ...base, songReviews: [{ ...hcb, title: null }, { ...hcb, bars: 'no' }, null] }), plain);
});

test('describePlan: the review is named first, with 1-based bars', () => {
  const blocks = planSession({ ...base, songReviews: [hcb] });
  assert.match(describePlan(blocks, (id) => id), /^Today: review Hot Cross Buns, bars 3-4, then /);
  assert.equal(describePlan([{ kind: 'songReview', ...hcb }]), 'Today: review Hot Cross Buns, bars 3-4.');
});

test('nextPlanStep: the review block is never served as a drill task', () => {
  assert.equal(nextPlanStep([{ kind: 'songReview', ...hcb }], {}), null);
  const blocks = planSession({ ...base, songReviews: [hcb] });
  assert.deepEqual(nextPlanStep(blocks, {}), nextPlanStep(planSession(base), {}));
});
