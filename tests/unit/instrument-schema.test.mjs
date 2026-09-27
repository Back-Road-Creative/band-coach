// src/instruments/schema.js: provenance.contentRev / provenance.reviewedRev
// validation. contentRev names which revision of the curriculum content a
// reviewer looked at; reviewedRev records which revision was actually
// reviewed. Both are optional positive integers. reviewedRev may only be set
// alongside a fully-reviewed provenance (reviewedBy/reviewedAt both set),
// and can never be ahead of contentRev.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateInstrument } from '../../src/instruments/schema.js';

function base() {
  return {
    id: 'test-instrument',
    name: 'Test Instrument',
    family: 'keys',
    input: 'midi',
    range: { low: 40, high: 60 },
    transposition: 0,
    clefs: ['treble'],
    octavePolicy: 'exact',
    status: 'planned',
    curriculum: []
  };
}

test('validateInstrument accepts provenance with no contentRev/reviewedRev (unchanged shape)', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: null, reviewedAt: null } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateInstrument accepts a reference-only provenance with a contentRev noted', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: null, reviewedAt: null, contentRev: 3 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateInstrument accepts a fully-reviewed provenance with matching contentRev/reviewedRev', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 3, reviewedRev: 3 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateInstrument accepts a fully-reviewed provenance with reviewedRev behind contentRev (stale review, still valid data)', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 5, reviewedRev: 3 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateInstrument rejects reviewedRev on a reference-only (not-yet-reviewed) provenance', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: null, reviewedAt: null, reviewedRev: 1 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, false);
});

test('validateInstrument rejects reviewedRev greater than contentRev', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 2, reviewedRev: 3 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, false);
});

test('validateInstrument rejects a non-integer contentRev', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: null, reviewedAt: null, contentRev: 1.5 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, false);
});

test('validateInstrument rejects a zero or negative contentRev', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: null, reviewedAt: null, contentRev: 0 } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, false);
});

test('validateInstrument rejects a non-integer reviewedRev', () => {
  const rec = { ...base(), provenance: { reference: 'X', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24', contentRev: 2, reviewedRev: 'two' } };
  const result = validateInstrument(rec);
  assert.equal(result.ok, false);
});
