// The boot flake is not per-test, so the retry does not belong per-test.
//
// #36 wrapped boot-ready's own test in `retryFlaky`. Then the SAME failure --
// `the page never finished booting (no data-coach-ready ... within 60000ms)`
// -- turned up in deaf-window.test.mjs, which #36 never touched. It can turn
// up in any test that calls `launchPage`, because the thing that runs out of
// budget is the launch, not the assertion. Wrapping call sites one at a time
// is whack-a-mole; every new browser test would have to remember to do it.
//
// So the retry moves into `launchPage` itself, and this file tests the policy
// that decides when to retry -- without spawning a browser, by handing it fake
// launches. What it must get right:
//   - a launch that works costs exactly one attempt (no hidden slowdown)
//   - a boot deadline is retried, because that is the transient
//   - ANY other error is NOT retried, because a crash is not a flake and
//     retrying one turns a clear failure into three slow identical ones
//   - giving up still reports a boot deadline, naming how many attempts ran
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOT_DEADLINE_CODE,
  bootDeadlineError,
  retryOnBootDeadline,
} from '../helpers/browser.mjs';

test('a launch that succeeds costs exactly one attempt', async () => {
  let calls = 0;
  const page = await retryOnBootDeadline(async () => {
    calls += 1;
    return { id: 'page' };
  });
  assert.deepEqual(page, { id: 'page' });
  assert.equal(calls, 1, 'the happy path must not pay for the retry');
});

test('a boot deadline is retried and the successful page returned', async () => {
  let calls = 0;
  const page = await retryOnBootDeadline(async () => {
    calls += 1;
    if (calls < 3) throw bootDeadlineError(60000);
    return { id: 'page', attempt: calls };
  });
  assert.equal(page.attempt, 3, 'the page from the attempt that worked is the one handed back');
  assert.equal(calls, 3);
});

test('any other error is not retried', async () => {
  let calls = 0;
  const boom = new Error('No Chromium-family browser found. Set CHROME_BIN');
  await assert.rejects(
    () =>
      retryOnBootDeadline(async () => {
        calls += 1;
        throw boom;
      }),
    (err) => err === boom,
  );
  assert.equal(calls, 1, 'a missing browser is not a flake -- retrying only wastes the wall clock');
});

test('giving up reports a boot deadline and how many attempts ran', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryOnBootDeadline(
        async () => {
          calls += 1;
          throw bootDeadlineError(60000);
        },
        { attempts: 3 },
      ),
    (err) => {
      assert.equal(err.code, BOOT_DEADLINE_CODE, 'the failure keeps its identity for any outer caller');
      assert.match(err.message, /3 attempts/, 'a reader must see this was not a one-off');
      return true;
    },
  );
  assert.equal(calls, 3, 'bounded: it does not keep trying forever on a genuinely broken boot');
});
