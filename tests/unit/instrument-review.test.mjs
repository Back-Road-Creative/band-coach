// src/instruments/review.js: the pure predicate that decides whether an
// instrument record's curriculum has actually been checked by a musician,
// straight off schema.js's own provenance shape (see its comment: null,
// reference-only with reviewedBy/reviewedAt both null, or fully reviewed
// with both filled in). Only the fully-reviewed shape counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isReviewed, isReviewCurrent } from '../../src/instruments/review.js';

test('isReviewed: null provenance is unreviewed', () => {
  assert.equal(isReviewed(null), false);
});

test('isReviewed: reference-only provenance (reviewedBy/reviewedAt both null) is unreviewed', () => {
  assert.equal(isReviewed({ reference: 'Standard of Excellence, Book 1', reviewedBy: null, reviewedAt: null }), false);
});

test('isReviewed: fully reviewed provenance (reviewedBy and reviewedAt both set) is reviewed', () => {
  assert.equal(isReviewed({ reference: 'Standard of Excellence, Book 1', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24' }), true);
});

test('isReviewed: never throws on a malformed shape', () => {
  assert.equal(isReviewed(undefined), false);
  assert.equal(isReviewed('reviewed by someone'), false);
  assert.equal(isReviewed({}), false);
});

// isReviewCurrent: a review can go stale when the content it approved
// changes underneath it. contentRev names the curriculum's current revision;
// reviewedRev names the revision that was actually reviewed. A record with
// no contentRev declared has no way to go stale, so a plain review counts.
test('isReviewCurrent: an unreviewed provenance is never current', () => {
  assert.equal(isReviewCurrent(null), false);
  assert.equal(isReviewCurrent({ reference: 'X', reviewedBy: null, reviewedAt: null }), false);
});

test('isReviewCurrent: reviewed with no contentRev declared is current', () => {
  assert.equal(isReviewCurrent({ reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24' }), true);
});

test('isReviewCurrent: reviewed with reviewedRev matching contentRev is current', () => {
  assert.equal(isReviewCurrent({ reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 3, reviewedRev: 3 }), true);
});

test('isReviewCurrent: reviewed with reviewedRev behind contentRev is stale', () => {
  assert.equal(isReviewCurrent({ reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 5, reviewedRev: 3 }), false);
});

test('isReviewCurrent: reviewed with a contentRev declared but no reviewedRev recorded is stale', () => {
  assert.equal(isReviewCurrent({ reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 3 }), false);
});
