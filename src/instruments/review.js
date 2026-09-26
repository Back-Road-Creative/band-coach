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
