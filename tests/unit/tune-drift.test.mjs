// F6: the median of the last few clean notes says whether the instrument
// itself has drifted. One sour note is the player; eight sour the same way is
// the strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuneDrift, DRIFT_NOTES, DRIFT_LIMIT_CENTS } from '../../src/core/tune-drift.js';

test('eight notes 30 cents flat read as about 30 cents flat', () => {
  assert.deepEqual(tuneDrift(Array(8).fill(-30)), { cents: 30, flat: true });
});

test('sharp drift says sharp, rounded to the nearest 5 cents', () => {
  assert.deepEqual(tuneDrift([22, 24, 26, 23, 27, 24, 25, 26]), { cents: 25, flat: false });
});

test('in tune, or inside the 20 cent limit, says nothing', () => {
  assert.equal(tuneDrift(Array(8).fill(3)), null);
  assert.equal(tuneDrift(Array(8).fill(-DRIFT_LIMIT_CENTS)), null);
});

test('fewer than eight notes is not enough to judge', () => {
  assert.equal(DRIFT_NOTES, 8);
  assert.equal(tuneDrift(Array(7).fill(-40)), null);
});

test('a few wild notes do not move the median', () => {
  assert.equal(tuneDrift([-45, 48, 2, 1, -3, 0, 4, -2]), null);
});

test('only the last eight count, and junk values are skipped', () => {
  assert.equal(tuneDrift([...Array(8).fill(-40), ...Array(8).fill(0)]), null);
  assert.deepEqual(tuneDrift([NaN, undefined, ...Array(8).fill(-30)]), { cents: 30, flat: true });
});
