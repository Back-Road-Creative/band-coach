# CI scheduling

The public repository's `ci.yml` runs development tests and release acceptance
in separate GitHub-hosted jobs. They have separate checkouts and build directories;
neither waits for the other's suite. A final job named `test` requires every
selected job to succeed and checks that each report names the current commit and
exact planned families. Missing reports, failures, cancellations and unexpected
skips fail that final check.

`build/ci-plan.mjs` uses the existing `build/ci-select.mjs` family selection.
A pull request keeps its selected coverage. A push to `main`, an unknown path or
an unreadable/empty diff selects every family. Development runs root, build,
characterization and unit families; release acceptance runs once in the release
job. Each worker first runs the cheap release size/smoke gate. The release job
keeps `ci-summary.mjs`'s rejection of retries, skips and incomplete acceptance
results. Local `npm test` and the full weekly browser runs keep their existing
pretest/posttest behavior.

Release acceptance builds both development and release HTML in its own
checkout: the update-check tests deliberately inspect both variants. A shell
regression executes the actual workflow command with an isolated npm fixture
and verifies that a failed prerequisite stops acceptance and reports failure.

When all development families are selected, CI builds explicitly and runs
`npm --ignore-scripts test`. This invokes the native development command once,
preserving its file concurrency across families while suppressing its release
posttest. A real npm fixture verifies that the main test runs and the hooks do
not. Narrow selections keep their existing family commands.

All four jobs use standard `ubuntu-latest` and refuse to start when repository
visibility is private. This workflow adds no paid runner, cache service or
billing setting. The two workers send compact reports through job outputs; only
the final job uploads the existing `run-summary-<run>-<attempt>` artifact, with
both workers' results under `jobs`. Detailed TAP output and failure reasons stay
in job logs and step summaries. Failure screenshots/logs retain separate worker
names to avoid upload collisions and expire after one day (previously seven).

The single-run baseline is 23m52s in the test/release step of run 39444905392
(2026-10-20): development took 17m41s and release 6m10s. Parallel scheduling
could remove about six minutes of serial waiting, before setup overhead.
Measure the new workflow before claiming that saving. The slowest worker plus
setup and final aggregation sets the new lower bound.
The four keyboard journeys are already one file each
(`tests/characterization/kbd-journey-*.test.mjs`), so they run in parallel under
the existing load-aware file concurrency cap. Do not replace journeys with
skips, shorter timeouts, or a one-session concurrency override.

Validate planning, failure handling, coverage and workflow contracts offline:

```sh
node --test tests/unit/ci-parallel.test.mjs \
  tests/unit/ci-workflow-no-duplicate-run.test.mjs \
  tests/unit/ci-workflow-artifacts-weekly.test.mjs \
  tests/build/ci-select.test.mjs tests/unit/ci-run-summary.test.mjs \
  tests/unit/workflow-actions-pinned.test.mjs
```

Repository changes still require the full affected families and successful CI.
