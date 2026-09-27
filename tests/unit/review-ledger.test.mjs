import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isReviewCurrent } from '../../src/instruments/review.js';
import { LEDGER, contentRev, itemReview } from '../../src/instruments/review-ledger.js';

const x = { a: 1, b: [1, 2, 3] };
const x2 = { a: 1, b: [1, 2, 4] };

test('an item absent from the ledger is unreviewed', () => {
  assert.equal(isReviewCurrent(itemReview('kbd.curriculum.1', contentRev(x))), false);
});

test('an item present in a fixture ledger, matching its content rev, is current', () => {
  const fixture = Object.freeze({
    'kbd.curriculum.1': {
      reference: 'R',
      reviewedBy: 'A. Player',
      reviewedAt: '2026-09-27',
      reviewedRev: contentRev(x)
    }
  });
  assert.equal(isReviewCurrent(itemReview('kbd.curriculum.1', contentRev(x), fixture)), true);
});

test('editing the content after review makes it stale', () => {
  const fixture = Object.freeze({
    'kbd.curriculum.1': {
      reference: 'R',
      reviewedBy: 'A. Player',
      reviewedAt: '2026-09-27',
      reviewedRev: contentRev(x)
    }
  });
  assert.equal(isReviewCurrent(itemReview('kbd.curriculum.1', contentRev(x2), fixture)), false);
});

test('contentRev is order-independent over object keys and is 8 hex digits', () => {
  assert.equal(contentRev({ a: 1, b: 2 }), contentRev({ b: 2, a: 1 }));
  assert.match(contentRev(x), /^[0-9a-f]{8}$/);
});

test('the shipped ledger has no fabricated reviews: every entry is fully attributed', () => {
  for (const [id, entry] of Object.entries(LEDGER)) {
    assert.ok(typeof entry.reference === 'string' && entry.reference.length > 0, id + ': missing reference');
    assert.ok(typeof entry.reviewedBy === 'string' && entry.reviewedBy.length > 0, id + ': missing reviewedBy');
    assert.ok(typeof entry.reviewedAt === 'string' && entry.reviewedAt.length > 0, id + ': missing reviewedAt');
    assert.ok(typeof entry.reviewedRev === 'string' && entry.reviewedRev.length > 0, id + ': missing reviewedRev');
  }
});
