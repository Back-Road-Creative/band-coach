// src/instruments/review.js: the pure predicate that decides whether an
// instrument record's curriculum has actually been checked by a musician,
// straight off schema.js's own provenance shape (see its comment: null,
// reference-only with reviewedBy/reviewedAt both null, or fully reviewed
// with both filled in). Only the fully-reviewed shape counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isReviewed } from '../../src/instruments/review.js';

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
