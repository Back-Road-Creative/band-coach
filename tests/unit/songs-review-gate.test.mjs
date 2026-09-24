// review.js and learn.js give the same practise decision (P3-2, a
// behaviour-preserving move of "Learn this"'s review screen into
// src/ui/songs/review.js): learn.js now just re-exports practiceGate from
// there, so both imports must be the exact same function and agree on
// every case, proving the move changed nothing about the decision itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceGate as gateFromReview } from '../../src/ui/songs/review.js';
import { practiceGate as gateFromLearn } from '../../src/ui/learn.js';

test('review.js and learn.js give the same practise decision', () => {
  assert.equal(gateFromReview, gateFromLearn, 'learn.js re-exports the exact same function, not a copy');
  for (const warnings of [[], ['Bar 2 beat 3 note unclear'], undefined]) {
    assert.deepEqual(gateFromReview(warnings), gateFromLearn(warnings));
  }
});
