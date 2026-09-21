// ci.yml used to trigger on `push: branches: ['**']` AND `pull_request`, which
// ran the ENTIRE suite twice, concurrently, for every push to a PR branch.
//
// The `concurrency` group below is `ci-${{ github.ref }}`, and those two events
// do not share a ref: a push carries `refs/heads/<branch>` while a pull_request
// carries `refs/pull/<n>/merge`. So the duplicate was not deduplicated by the
// concurrency guard -- the two runs raced each other for the same self-hosted
// box, which has 12 cores shared between three runners, under this job's
// `timeout-minutes: 10`.
//
// That is not theoretical. On 2026-09-21 it killed three runs in one afternoon
// (PRs #58 and #59, the latter twice) with "The job has exceeded the maximum
// execution time of 10m0s" -- while the very same commit passed its twin job in
// 2m21s. A timeout reports as a plain `fail` in `gh pr checks`, so each one
// looked like a real test failure until its annotations were opened.
//
// Both properties the robot depends on survive restricting push to `main`,
// verified against real runs before this change:
//
//   - the PR-head proof: a `pull_request` run's `head_sha` IS the PR head
//     commit (run 35636761647 carried head 33c4c36, exactly PR #59's head), so
//     bin/autoland.py's `_ci_runs(sha)` still finds a run on the PR head.
//   - the integration barrier: pushes to `main` still trigger ci.yml, which is
//     what bin/autoland.py's barrier reads on the integration head.
//
// Asserting on the workflow's text, the same way release-consistency-workflow
// and store-package-workflow are tested: a workflow cannot be imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('ci does not run twice for one push to a PR branch', () => {
  const text = workflow();
  assert.doesNotMatch(
    text,
    /branches:\s*\[\s*'\*\*'\s*\]/,
    "push must not trigger on every branch: with pull_request also enabled that runs the whole "
      + 'suite twice concurrently, and the two events have different github.ref so the concurrency '
      + 'group cannot collapse them',
  );
});

test('push still triggers ci on main, so the autoland barrier has a run to read', () => {
  const text = workflow();
  assert.match(
    text,
    /push:\s*\n\s*branches:\s*\[\s*main\s*\]/,
    'bin/autoland.py reads the barrier from a ci.yml run on the integration head (main); '
      + 'removing the push trigger entirely would leave it reporting no-run for ever',
  );
});

test('pull_request still triggers ci, so a PR head is still proven', () => {
  const text = workflow();
  assert.match(
    text,
    /^\s*pull_request:\s*$/m,
    "the PR-head proof is the pull_request run; its head_sha is the PR's head commit",
  );
});
