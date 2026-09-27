// Pure predicate: has a real musician actually checked this instrument
// record's curriculum against a method book or teaching standard, or is it
// still provisional? Straight off schema.js's own provenance shape (see its
// comment there) -- null (nothing noted), a reference-only object
// (reviewedBy/reviewedAt both null: "reference noted, review still
// pending"), and a fully-reviewed object (both filled in) are the only three
// shapes validateInstrument allows. Only the third one counts as reviewed;
// the UI must never present a beginner-fingering chart or curriculum as
// checked just because SOME reference is on file. Never throws -- a
// malformed value (should never happen once validateInstrument has run, but
// this file doesn't get to assume that) is simply unreviewed.
export function isReviewed(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false;
  return typeof provenance.reviewedBy === 'string' && provenance.reviewedBy.length > 0
    && typeof provenance.reviewedAt === 'string' && provenance.reviewedAt.length > 0;
}

// Is a review still trustworthy, or has the content it approved moved on
// since? schema.js's provenance carries an optional contentRev (the
// curriculum's current revision) and reviewedRev (the revision a review
// actually covered). A record with no contentRev declared has no way to go
// stale, so a plain isReviewed() is enough; once contentRev is declared, the
// review only counts as current when reviewedRev was recorded and matches
// it exactly -- behind means the content changed after the review, and
// schema.js already rejects ahead as invalid data.
export function isReviewCurrent(provenance) {
  if (!isReviewed(provenance)) return false;
  if (provenance.contentRev === undefined) return true;
  return provenance.reviewedRev === provenance.contentRev;
}
