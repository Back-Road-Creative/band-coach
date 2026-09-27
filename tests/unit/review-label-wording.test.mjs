import { test } from 'node:test';
import assert from 'node:assert/strict';

import { en } from '../../src/core/i18n.js';

test('review badge wording says "player", not "musician"', () => {
  assert.equal(en['review.unreviewed'], 'Not yet checked by a player.');
  assert.match(en['review.unreviewedWithRef'], /player/);
  assert.match(en['review.unreviewedWithRef'], /\{reference\}/);
  assert.doesNotMatch(en['review.unreviewedWithRef'], /musician/i);
});
