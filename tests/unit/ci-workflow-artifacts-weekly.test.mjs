// ci.yml used to lose its evidence: a failing run left no screenshots or logs
// behind, the Chrome version it ran against was not recorded, and the 20-minute
// budget sat only ~5 minutes over the measured 12.9-15.0 minute passing runs of
// 2026-10-02. This pins the fix, and the weekly current-browser run that is a
// SEPARATE file: bin/autoland.py's `_ci_runs` counts every ci.yml run on a
// commit whatever its event, so a `schedule` trigger inside ci.yml would feed the
// merge barrier. Plain text and regexes, like ci-workflow-no-duplicate-run: a
// workflow cannot be imported and there is no YAML dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => {
  const file = fileURLToPath(new URL('../../.github/workflows/' + name, import.meta.url));
  assert.ok(existsSync(file), `.github/workflows/${name} must exist`);
  return readFileSync(file, 'utf8');
};
const ci = () => read('ci.yml');
const weekly = () => read('weekly-current-browser.yml');

// The text of a top-level key's block, up to the next top-level key.
function block(text, key) {
  const m = new RegExp('^' + key + ':[^\\n]*\\n((?:[ \\t].*\\n|[ \\t]*\\n)*)', 'm').exec(text);
  assert.ok(m, `workflow must have a top-level \`${key}:\` block`);
  return m[1];
}
// Everything after the job's `steps:` line (steps is the last key of the job).
function steps(text) {
  const i = text.search(/^ {4}steps:\s*$/m);
  assert.ok(i >= 0, 'the job must have a `steps:` block');
  return text.slice(i).replace(/\s+/g, ' ').trim();
}
// Individual `- ` steps, each normalised.
function stepList(text) {
  const body = text.slice(text.search(/^ {4}steps:\s*$/m)).split('\n').slice(1).join('\n');
  return body.split(/^ {6}- /m).slice(1).map((s) => s.replace(/\s+/g, ' ').trim());
}

test('ci uploads failure evidence as its last step, on failure or cancel', () => {
  const list = stepList(ci());
  const last = list[list.length - 1];
  assert.match(last, /\buses: actions\/upload-artifact@v4\b/, 'the last ci step must be actions/upload-artifact@v4');
  assert.match(last, /if: failure\(\) \|\| cancelled\(\)/, 'upload only when the run failed or was cancelled');
  assert.match(last, /path: dist\/test-artifacts\/?(?: |$)/, 'upload dist/test-artifacts/, where the acceptance lane writes failure evidence');
  assert.match(last, /if-no-files-found: ignore/, 'a run with nothing to keep must not fail the upload');
});

test('the artifact name is unique to the run and attempt, and retention is short', () => {
  const last = stepList(ci()).pop();
  const name = /with: name: (.+?) path:/.exec(last);
  assert.ok(name, 'the upload step needs a name');
  assert.match(name[1], /github\.run_id/, 'the name must carry the run id');
  assert.match(name[1], /github\.run_attempt/, 'the name must carry the attempt so a re-run does not collide');
  const days = /retention-days: (\d+)/.exec(last);
  assert.ok(days, 'the upload step needs an explicit retention-days');
  assert.ok(Number(days[1]) >= 1 && Number(days[1]) <= 14, `retention-days is ${days[1]}; keep it short (1-14)`);
});

test('ci records the Chrome version in the step summary, after locating it', () => {
  const text = ci();
  const locate = text.indexOf('name: locate Chrome');
  const summary = text.search(/"\$CHROME_BIN"\s+--version[^\n]*\$GITHUB_STEP_SUMMARY/);
  assert.ok(locate >= 0, 'the locate Chrome step must stay');
  assert.ok(summary >= 0, 'a step must write `"$CHROME_BIN" --version` to $GITHUB_STEP_SUMMARY');
  assert.ok(summary > locate, 'the version step must come after CHROME_BIN is set');
  assert.ok(summary < text.indexOf('npm ci'), 'record the browser before the suite installs and runs');
});

test('ci timeout is at least 30 minutes, with the measured durations cited', () => {
  const text = ci();
  const m = /timeout-minutes:\s*(\d+)/.exec(text);
  assert.ok(m && Number(m[1]) >= 30, `timeout-minutes is ${m && m[1]}; passing runs took 12.9-15.0 min on 2026-10-02 with the acceptance lane still to add`);
  assert.doesNotMatch(text, /8m21s/, 'the header must not keep the stale 2026-09-28 duration claim');
  assert.match(text, /12\.9-15\.0/, 'the header comment must cite the measured 12.9-15.0 minute runs');
});

test('ci.yml has no schedule or workflow_dispatch trigger', () => {
  const on = block(ci(), 'on');
  assert.doesNotMatch(on, /^\s*schedule:/m, 'a scheduled ci.yml run would feed the autoland barrier');
  assert.doesNotMatch(on, /^\s*workflow_dispatch:/m, 'a manual ci.yml run would feed the autoland barrier');
  const inline = /^on:([^\n]*)$/m.exec(ci());
  assert.doesNotMatch(inline[1], /schedule|workflow_dispatch/, 'nor in the inline form, on: [push, workflow_dispatch]');
});

test('the weekly workflow triggers only on schedule and workflow_dispatch', () => {
  const on = block(weekly(), 'on');
  assert.match(on, /^\s+schedule:\s*\n\s+- cron: ['"]?[\d*/,\- ]+['"]?\s*$/m, 'a weekly cron schedule');
  assert.match(on, /^\s+workflow_dispatch:/m, 'a manual trigger');
  assert.doesNotMatch(on, /^\s+push:/m, 'no push trigger');
  assert.doesNotMatch(on, /^\s+pull_request/m, 'no pull_request trigger');
  const keys = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((x) => x[1]).sort();
  assert.deepEqual(keys, ['schedule', 'workflow_dispatch'], 'exactly these two triggers');
});

test('the weekly workflow has its own concurrency group and read-only permissions', () => {
  const text = weekly();
  const group = /^concurrency:\s*\n\s+group:\s*(\S+)/m.exec(text);
  assert.ok(group, 'the weekly workflow needs a concurrency group');
  assert.doesNotMatch(group[1], /^ci-/, 'it must not share the ci- group');
  assert.match(block(text, 'permissions'), /^\s+contents:\s*read\s*$/m, 'permissions: contents: read');
  assert.match(text, /timeout-minutes:\s*(?:[3-9]\d|\d{3,})\b/, 'the weekly job needs the same >= 30 minute budget');
});

test('the weekly workflow runs exactly ci.yml\'s test-job steps', () => {
  const a = steps(ci());
  const b = steps(weekly());
  assert.ok(a.length > 200, 'ci steps were not extracted');
  assert.equal(b, a, 'the weekly steps must be identical to ci.yml\'s so the weekly run proves what a PR run proves');
});
