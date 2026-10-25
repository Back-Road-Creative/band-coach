import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyAgeDays } from '../../src/core/copy-age.js';

const DAY = 86400000;
const built = '2026-01-10';
const at = (days, extraMs = 0) => Date.UTC(2026, 0, 10) + days * DAY + extraMs;

test('a copy built today is 0 days old, even late in the day', () => {
  assert.equal(copyAgeDays(built, at(0)), 0);
  assert.equal(copyAgeDays(built, at(0, DAY - 1)), 0);
});

test('whole days count up from the build day', () => {
  assert.equal(copyAgeDays(built, at(1)), 1);
  assert.equal(copyAgeDays(built, at(200, 5000)), 200);
});

test('a clock set before the build day never shows a negative age', () => {
  assert.equal(copyAgeDays(built, at(-3)), 0);
});

test('no date (a dev build) or a malformed one gives null', () => {
  for (const bad of ['', null, undefined, 'yesterday', '2026-1-10', '2026-13-40']) assert.equal(copyAgeDays(bad, at(5)), null, String(bad));
  assert.equal(copyAgeDays(built, NaN), null);
});
