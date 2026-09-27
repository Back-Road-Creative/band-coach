// A per-item review ledger: unlike src/instruments/schema.js's per-record
// provenance (one review per whole instrument), this keys a review to one
// content item (e.g. one curriculum entry) plus a hash of that item's own
// content, so a later slice editing the item makes its review go stale on
// its own -- no one has to remember to clear a flag by hand. Pure -- no DOM,
// no AudioContext -- callers own everything else.
//
// Empty today: no player has reviewed anything through this ledger yet.
// Never add an entry here without a real reviewedBy/reviewedAt/reference --
// see the "no fabricated review" guard in
// tests/unit/review-ledger.test.mjs, which checks every entry the ledger
// ships is fully attributed.
export const LEDGER = Object.freeze({});

import { fnv1a } from '../song/lesson-resume.js';

// JSON.stringify with object keys sorted recursively (array order kept),
// so reordering an object's keys elsewhere in the codebase never makes a
// review look stale for no reason.
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// An 8-hex-digit fingerprint of a piece of content, order-independent over
// object keys. Reuses lesson-resume.js's existing FNV-1a rather than a
// second hash implementation.
export function contentRev(value) {
  return fnv1a(canonicalJson(value));
}

// Looks up id's review in ledger (LEDGER by default) and folds in rev (the
// caller's current content hash) as contentRev -- the caller's rev always
// wins over whatever the ledger entry itself might have recorded, which is
// what makes an edited item's review read as stale via isReviewCurrent.
// Returns null when the item has no ledger entry at all (never reviewed).
export function itemReview(id, rev, ledger = LEDGER) {
  const entry = ledger[id];
  if (!entry) return null;
  return { ...entry, contentRev: rev };
}
