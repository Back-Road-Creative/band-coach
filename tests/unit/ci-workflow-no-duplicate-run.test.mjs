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

// The suite itself has since grown past the old budget: on 2026-09-28 the
// `npm test` step took 8m21s-9m36s on ubuntu-latest for four PASSING runs
// (35636761647's era was 2m21s), and three PR runs launched in the same minute
// (#324, #329, #331) were all cancelled at 10m06s by `timeout-minutes: 10` with
// no test failing. A cancelled step reports the same `cancel` bucket the robot
// treats as stuck-red, so every timeout cost an empty-commit re-run that could
// time out again. The job budget must leave headroom over the measured
// duration, not sit on top of it.
test('the job timeout leaves headroom over the measured suite duration', () => {
  const text = workflow();
  const m = /timeout-minutes:\s*(\d+)/.exec(text);
  assert.ok(m, 'the test job must keep an explicit timeout-minutes');
  assert.ok(
    Number(m[1]) >= 20,
    `timeout-minutes is ${m[1]}; passing runs take up to 9m36s on ubuntu-latest (2026-09-28), `
      + 'so anything under 20 turns a slow runner into a cancelled run with no failing test',
  );
});

// The release size budget is the cheap, decisive check: on 2026-09-28 it failed
// only AFTER the 7m47s browser suite (the gate step itself takes about 5 s), so
// the author waited for the whole suite to learn about a size overrun. The first
// test step therefore builds the release and runs ONLY tests/release/gate.test.mjs
// (the size budget and the smoke checks). The full release lane, acceptance-*
// included, then runs once, as `npm test`'s posttest. The first version of this
// pin counted an `npm run gate` step; that step ran every release file, so the
// lane ran twice per job. The claim changed with the workflow, it was not loosened.
test('ci runs the full release lane exactly once: gate.test.mjs first, then npm test with its posttest', () => {
  const stripped = workflow().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(stripped, /npm run gate/, 'no step runs `npm run gate`; npm test already runs it as posttest');
  assert.doesNotMatch(stripped, /tests\/release\/\*\.test\.mjs/, 'no step globs the whole release lane; the posttest owns that');
  const lines = stripped.split('\n');
  // Both commands must sit in the step with `id: gate` (6-space `- ` item up to the next one), not just somewhere in the file.
  const start = lines.findIndex((l) => /^ {6}- id: gate\s*$/.test(l));
  assert.ok(start >= 0, 'ci.yml needs a step with `id: gate`');
  let end = lines.findIndex((l, i) => i > start && /^ {6}- /.test(l));
  if (end < 0) end = lines.length;
  const gateStep = lines.slice(start, end);
  const buildAt = start + gateStep.findIndex((l) => l.includes('node build/build.mjs --release'));
  const gateAt = start + gateStep.findIndex((l) => l.includes('node --test tests/release/gate.test.mjs'));
  assert.ok(buildAt >= start, 'the `id: gate` step builds the release first');
  assert.ok(gateAt >= buildAt, 'the `id: gate` step runs gate.test.mjs after building');
  const suites = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*(?:-\s*)?(?:run:\s*)?npm test\b/.test(l));
  assert.equal(suites.length, 1, 'exactly one command starting with `npm test`');
  assert.ok(gateAt < suites[0][1], 'gate.test.mjs must run before the browser suite so a size-budget failure surfaces in seconds');
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.scripts.posttest, 'npm run gate', 'npm test must still run the gate as posttest, or the lane would not run at all');
  assert.equal(pkg.scripts.gate, 'npm run test:release', 'gate stays an alias of test:release');
  assert.ok(pkg.scripts['test:release'].includes('tests/release/*.test.mjs'), 'the release script runs every release file');
});
