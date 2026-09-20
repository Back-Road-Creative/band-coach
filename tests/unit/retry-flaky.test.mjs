// retryFlaky is the mechanism standing between a starved CI runner and a red
// build, so it needs its own test: the characterization tests that use it
// normally succeed on the first attempt, which means they never exercise the
// retry path at all and would not notice if it were broken.
//
// The properties that matter are the ones that keep it from becoming a way to
// paper over real failures:
//   - a genuinely broken measurement still fails, after exactly `attempts`
//     tries, and every attempt's detail survives into the message;
//   - a transient failure followed by success passes, and returns the
//     successful result rather than the failed one;
//   - a measurement that works first time costs exactly one attempt, so the
//     retry adds no wall-clock to a healthy suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryFlaky } from '../helpers/browser.mjs';

test('retryFlaky: a first-attempt success costs exactly one attempt', async () => {
  let calls = 0;
  const out = await retryFlaky({
    what: 'a thing',
    attempt: () => { calls++; return { ok: true, n: calls }; },
    accept: (r) => r.ok,
  });
  assert.equal(calls, 1, 'a healthy measurement must not pay for the retry');
  assert.equal(out.n, 1);
});

test('retryFlaky: a transient failure is retried and the good result returned', async () => {
  let calls = 0;
  const out = await retryFlaky({
    what: 'a flaky thing',
    attempt: () => { calls++; return { ok: calls === 3, n: calls }; },
    accept: (r) => r.ok,
  });
  assert.equal(calls, 3);
  assert.equal(out.n, 3, 'the SUCCESSFUL attempt must be returned, not the last failure');
});

test('retryFlaky: a genuine failure still fails, after exactly `attempts` tries', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryFlaky({
      attempts: 3,
      what: 'a broken thing',
      attempt: () => { calls++; return { ok: false, n: calls }; },
      accept: (r) => r.ok,
      describe: (r) => `n=${r.n}`,
    }),
    (err) => {
      assert.match(err.message, /a broken thing did not succeed in 3 independent attempts/);
      // Every attempt's detail must survive: "failed on all three" and
      // "failed once" are different diagnoses and the message has to tell
      // them apart.
      assert.match(err.message, /attempt 1: n=1/);
      assert.match(err.message, /attempt 2: n=2/);
      assert.match(err.message, /attempt 3: n=3/);
      assert.equal(err.attempts.length, 3);
      return true;
    },
  );
  assert.equal(calls, 3, 'must not keep retrying past the bound');
});

test('retryFlaky: a throwing attempt is not swallowed', async () => {
  // A crash is not a flake. If the measurement itself throws — a browser that
  // will not launch, a helper with a typo — that must surface as itself, not
  // be retried into a generic "did not succeed" three attempts later.
  let calls = 0;
  await assert.rejects(
    () => retryFlaky({
      what: 'a crashing thing',
      attempt: () => { calls++; throw new Error('browser failed to launch'); },
      accept: () => true,
    }),
    /browser failed to launch/,
  );
  assert.equal(calls, 1, 'a thrown error must abort immediately, not burn the retry budget');
});
