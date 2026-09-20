// The suite runs every *.test.mjs file as its own node:test process, and each
// characterization file launches its own Chromium. With no --test-concurrency
// flag, node defaults to os.availableParallelism() concurrent files — on a
// 12-core box that is 12 simultaneous Chromium launches. When the box is
// already loaded (a sibling CI suite plus its own ~50 Chromium processes,
// load ~41), the first browser launch in a file misses the 60s boot deadline
// even though the app and the test are both fine — see
// tests/unit/browser-wait-floor.test.mjs for the sibling flake this is the
// same family as. This does not touch that deadline; it stops the suite from
// launching more browsers at once than the box can actually boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTestConcurrency } from '../helpers/browser.mjs';

test('a quiet box (load at or below core count) keeps full concurrency', () => {
  assert.equal(computeTestConcurrency({ cores: 12, load1: 1 }), 12, 'a near-idle box must not be throttled');
  assert.equal(computeTestConcurrency({ cores: 4, load1: 2 }), 4, 'a small CI runner must not run slower than its own default');
  assert.equal(computeTestConcurrency({ cores: 4, load1: 4 }), 4, 'load exactly at the core count is still quiet, not overloaded');
});

test('an overloaded box (load above core count) is throttled proportionally', () => {
  assert.equal(computeTestConcurrency({ cores: 12, load1: 42.71 }), 3, 'load ~3.5x cores must not still launch 12 browsers at once');
  assert.equal(computeTestConcurrency({ cores: 12, load1: 24 }), 6, 'double the core count in load halves the concurrency');
});

test('concurrency never drops below 1 no matter how loaded the box is', () => {
  assert.equal(computeTestConcurrency({ cores: 12, load1: 1000 }), 1);
});

test('BAND_COACH_TEST_CONCURRENCY overrides the computed value', () => {
  const prev = process.env.BAND_COACH_TEST_CONCURRENCY;
  process.env.BAND_COACH_TEST_CONCURRENCY = '2';
  try {
    assert.equal(computeTestConcurrency({ cores: 12, load1: 1 }), 2, 'an explicit override wins even on a quiet box');
    assert.equal(computeTestConcurrency({ cores: 12, load1: 1000 }), 2, 'an explicit override wins even on an overloaded box');
  } finally {
    if (prev === undefined) delete process.env.BAND_COACH_TEST_CONCURRENCY;
    else process.env.BAND_COACH_TEST_CONCURRENCY = prev;
  }
});

test('a non-numeric or non-positive override is ignored, not treated as 0', () => {
  const prev = process.env.BAND_COACH_TEST_CONCURRENCY;
  process.env.BAND_COACH_TEST_CONCURRENCY = 'nope';
  try {
    assert.equal(computeTestConcurrency({ cores: 12, load1: 1 }), 12);
  } finally {
    if (prev === undefined) delete process.env.BAND_COACH_TEST_CONCURRENCY;
    else process.env.BAND_COACH_TEST_CONCURRENCY = prev;
  }
});
