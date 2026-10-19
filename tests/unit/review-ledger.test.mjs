import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isReviewCurrent, instrumentUnreviewed } from '../../src/instruments/review.js';
import { INSTRUMENTS, byId } from '../../src/instruments/index.js';
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

test('every ledger entry id names an item of a real instrument and has a well-formed review date', () => {
  assert.ok(INSTRUMENTS.length > 0);
  for (const [id, entry] of Object.entries(LEDGER)) {
    assert.ok(byId[id.split('.')[0]], id + ': first segment is not a real instrument id');
    assert.match(entry.reviewedAt, /^\d{4}-\d{2}-\d{2}$/, id + ': reviewedAt must be YYYY-MM-DD');
  }
});

test('instrumentUnreviewed: true for every record whose provenance is null, false once a real review is on file', () => {
  const nulls = INSTRUMENTS.filter(r => r.provenance === null);
  assert.ok(nulls.length > 0);
  nulls.forEach(r => assert.equal(instrumentUnreviewed(r), true, r.id));
  assert.equal(instrumentUnreviewed({ ...nulls[0], provenance: { reference: 'Book 1', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24' } }), false);
  assert.equal(instrumentUnreviewed({ ...nulls[0], provenance: { reference: 'Book 1', reviewedBy: null, reviewedAt: null } }), true);
  assert.equal(instrumentUnreviewed(undefined), false, 'no record (ear, rhythm) has nothing to label');
});
