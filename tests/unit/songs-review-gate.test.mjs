// review.js's practiceGate and song-status.js's reviewGate give the same
// practise decision. This test began as P3-2's proof that learn.js re-exported
// review.js's function unchanged; P3-6 retired src/ui/learn.js, so the agreement
// it now guards is between the two surviving copies of the rule (song-status.js
// keeps its own so the pure ledger module never imports the DOM-facing review
// screen) -- if either drifts, the list's "Draft — N notes to check" and the
// review's disabled "Practise this" would disagree about the same song.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceGate as gateFromReview } from '../../src/ui/songs/review.js';
import { reviewGate as gateFromLedger } from '../../src/ui/songs/song-status.js';

test('review.js and song-status.js give the same practise decision', () => {
  // P3-6: learn.js is gone, so the identity check went with it; the two
  // remaining copies must still agree case by case.
  for (const warnings of [[], ['Bar 2 beat 3 note unclear'], undefined]) {
    assert.deepEqual(gateFromReview(warnings), gateFromLedger(warnings));
  }
});
