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
// The job's `steps:` block (steps is the last key of the job), up to the next
// job so a second job in the file (the weekly alert) is not read as these steps.
function steps(text, job = 'test') {
  const at = text.search(new RegExp('^ {2}' + job + ':\\s*$', 'm'));
  assert.ok(at >= 0, `the workflow must have a \`${job}:\` job`);
  const rest = text.slice(at).split('\n').slice(1).join('\n');
  const end = rest.search(/^ {0,2}\S/m);
  const own = end < 0 ? rest : rest.slice(0, end);
  const i = own.search(/^ {4}steps:\s*$/m);
  assert.ok(i >= 0, 'the job must have a `steps:` block');
  return own.slice(i).replace(/\s+/g, ' ').trim();
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
  const b = steps(weekly(), 'test');
  assert.ok(a.length > 200, 'ci steps were not extracted');
  assert.equal(b, a, 'the weekly steps must be identical to ci.yml\'s so the weekly run proves what a PR run proves');
});

// The run summary (build/ci-summary.mjs) and the two exact exit codes it reads.
// Steps are compared as normalised text, like the pins above, with comment lines
// removed so a step's code is what is asserted, not the prose above the next one.
const codeSteps = () => stepList(ci().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'));
const find = (list, re, what) => {
  const s = list.find((x) => re.test(x));
  assert.ok(s, `ci.yml needs ${what}`);
  return s;
};
const uploads = (list) => list.filter((s) => /\buses: actions\/upload-artifact@v4\b/.test(s));

test('the build date is pinned to the commit before the first build', () => {
  const list = codeSteps();
  const at = list.findIndex((s) => s.includes('git log -1 --format=%ct') && s.includes('>> "$GITHUB_ENV"') && s.includes('SOURCE_DATE_EPOCH='));
  assert.ok(at >= 0, 'a step must export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) to $GITHUB_ENV');
  const build = list.findIndex((s) => s.includes('build/build.mjs'));
  assert.ok(build > at, 'the epoch must be exported before the first step that builds, or the candidate hash moves with the wall clock');
});

test('the gate and suite steps keep their own exit code and log outside dist/', () => {
  const list = codeSteps();
  for (const name of ['gate', 'suite']) {
    const s = find(list, new RegExp(`^id: ${name}\\b`), `a step with \`id: ${name}\``);
    assert.match(s, /\bshell: bash\b/, `${name}: shell: bash, so PIPESTATUS exists`);
    assert.match(s, /\$\{PIPESTATUS\[0\]\}/, `${name}: the exit code is the command's, not tee's`);
    assert.ok(s.includes(`tee "$RUNNER_TEMP/${name}.log"`), `${name}: the log is teed to $RUNNER_TEMP/${name}.log`);
    assert.ok(s.includes(`> "$RUNNER_TEMP/${name}.rc"`), `${name}: the exit code is written to $RUNNER_TEMP/${name}.rc`);
    assert.match(s, /exit "\$rc"/, `${name}: the step exits with that code`);
    assert.doesNotMatch(s, /dist\/[^ ]*\.(?:log|rc)\b/, `${name}: pretest's dev build deletes dist/, so nothing is kept there`);
  }
});

test('the run summary is computed after the suite, always, from both outcomes', () => {
  const list = codeSteps();
  const at = list.findIndex((s) => s.includes('build/ci-summary.mjs'));
  assert.ok(at >= 0, 'a step must run build/ci-summary.mjs');
  const s = list[at];
  assert.match(s, /\bif: always\(\)/, 'the summary runs when the suite failed too');
  assert.ok(s.includes('steps.gate.outcome') && s.includes('steps.suite.outcome'), 'it reads both step outcomes');
  const suite = list.findIndex((x) => /^id: suite\b/.test(x));
  assert.ok(suite >= 0 && at > suite, 'the summary must come after the suite step');
  const firstUpload = list.findIndex((x) => /\buses: actions\/upload-artifact@v4\b/.test(x));
  assert.ok(at < firstUpload, 'the summary must come before both uploads, or it uploads nothing');
});

test('the run summary is uploaded on every run, named by run and attempt', () => {
  const s = find(uploads(codeSteps()), /path: dist\/test-artifacts\/run-summary\.json\b/, 'an upload of dist/test-artifacts/run-summary.json');
  assert.match(s, /\bif: always\(\)/, 'upload on success as well as failure');
  const name = /with: name: (.+?) path:/.exec(s);
  assert.ok(name && /github\.run_id/.test(name[1]) && /github\.run_attempt/.test(name[1]), 'the name carries run id and attempt');
  assert.match(s, /if-no-files-found: error/, 'a missing summary means the step did not run, which is worth a red mark');
  const days = /retention-days: (\d+)/.exec(s);
  assert.ok(days && Number(days[1]) >= 1 && Number(days[1]) <= 14, 'short retention (1-14)');
});

test('the failure upload is still last, and there are exactly two uploads', () => {
  const list = codeSteps();
  const ups = uploads(list);
  assert.equal(ups.length, 2, 'the run summary and the failure evidence, nothing else');
  assert.equal(list[list.length - 1], ups[1], 'the failure upload stays the last step');
  assert.match(ups[1], /if: failure\(\) \|\| cancelled\(\)/);
  assert.ok(list.indexOf(ups[0]) < list.indexOf(ups[1]));
});

// The weekly alert: a red Monday run used to be visible only on the Actions tab,
// so users on auto-updated Chrome hit a break for days. The run now opens (or
// comments on) ONE issue, closes it when the run is green again, and a second
// job runs the same steps on Chrome beta so a break shows up before it ships.
const jobBody = (text, name) => {
  const m = new RegExp('^ {2}' + name + ':[^\\n]*\\n((?:(?: {4}.*)?\\n)*)', 'm').exec(text);
  assert.ok(m, `weekly workflow must have a \`${name}:\` job`);
  return m[1];
};
const bodySteps = (body) => body.slice(body.search(/^ {4}steps:\s*$/m)).split('\n').slice(1).join('\n').split(/^ {6}- /m).slice(1).map((s) => s.replace(/\s+/g, ' ').trim());
const noComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('the weekly workflow keeps read-only defaults; only the alert job may write issues', () => {
  const text = weekly();
  assert.doesNotMatch(block(text, 'permissions'), /issues:/, 'the workflow-wide permissions stay contents: read');
  const report = jobBody(text, 'report');
  assert.match(report, /^ {4}permissions:\s*\n(?: {6}.*\n)*? {6}issues:\s*write\s*$/m, 'the alert job needs issues: write');
  assert.match(report, / {6}actions:\s*read\s*$/m, 'and actions: read to download the run summaries');
  for (const name of ['test', 'test-beta']) assert.doesNotMatch(jobBody(text, name), /\bpermissions:/, `${name} runs the suite with the read-only defaults`);
});

test('the alert job runs after both test jobs, whatever their result', () => {
  const report = jobBody(weekly(), 'report');
  assert.match(report, /^ {4}needs:\s*\[\s*test\s*,\s*test-beta\s*\]\s*$/m, 'needs both test jobs');
  assert.match(report, /^ {4}if:\s*always\(\)\s*$/m, 'it runs when a needed job failed');
});

test('a failing run opens or updates ONE issue with the run URL and the Chrome version', () => {
  const list = bodySteps(noComments(jobBody(weekly(), 'report')));
  const s = list.find((x) => /\bgh issue create\b/.test(x));
  assert.ok(s, 'a step must `gh issue create`');
  assert.match(s, /\bif: needs\.test\.result == 'failure' \|\| needs\.test-beta\.result == 'failure'/, 'only when a test job failed (a cancelled run is not a break)');
  assert.ok(s.includes("title='weekly browser run failing'"), 'the one issue has a fixed title');
  assert.match(s, /\bgh issue list\b[^|]*--state open/, 'look for the open issue first, so a second red week updates it');
  assert.match(s, /\bgh issue comment\b/, 'an existing issue gets a comment, not a duplicate');
  // RUN_URL is built from the server URL and this run's id in the step's env...
  assert.match(s, /\bRUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/, 'RUN_URL points at this run');
  // ...and what is posted is the body, which must carry it and both Chrome versions.
  const body = /\bbody="([^"]*)"/.exec(s);
  assert.ok(body, 'the step builds the issue text as body="..."');
  assert.ok(body[1].includes('Run: $RUN_URL'), 'the body links the run');
  assert.ok(body[1].includes('$(chrome run-summary)'), 'the body names the stable Chrome version');
  assert.ok(body[1].includes('$(chrome run-summary-beta)'), 'the body names the Chrome beta version');
  assert.match(s, /\bgh issue create\b(?:(?!\bgh\b).)*?--body "\$body"/, 'a new issue is created with that body');
  assert.match(s, /\bgh issue comment\b(?:(?!\bgh\b).)*?--body "\$body"/, 'an existing issue is commented with that body');
  assert.match(s, /gh run download/, 'the Chrome version comes from the run summary the test job uploaded');
  assert.match(s, /\.facts\.chrome/, 'the version is the summary\'s facts.chrome');
  assert.match(s, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'gh needs the token');
});

test('a green run closes the issue', () => {
  const list = bodySteps(noComments(jobBody(weekly(), 'report')));
  const s = list.find((x) => /\bgh issue close\b/.test(x));
  assert.ok(s, 'a step must `gh issue close`');
  assert.match(s, /\bif: needs\.test\.result == 'success' && needs\.test-beta\.result == 'success'/, 'only when BOTH legs passed');
  assert.ok(s.includes("title='weekly browser run failing'"), 'it closes the same fixed-title issue');
  assert.match(s, /--state open/, 'only an open issue is touched');
});

test('the Chrome beta job installs beta and proves it before running the same steps', () => {
  const list = bodySteps(noComments(jobBody(weekly(), 'test-beta')));
  const [install, ...rest] = list;
  // One ordered pin: install the .deb, put the beta first on PATH as google-chrome
  // (what the unchanged `locate Chrome` step finds), then fail the job unless that
  // browser calls itself a beta, so the leg cannot quietly test stable.
  assert.match(install, /apt-get install -y "\$RUNNER_TEMP\/chrome-beta\.deb" sudo ln -sf \/usr\/bin\/google-chrome-beta \/usr\/local\/bin\/google-chrome \/usr\/local\/bin\/google-chrome --version \| tee -a "\$GITHUB_STEP_SUMMARY" \| \/bin\/grep -qi beta$/, 'install the beta .deb, link it as google-chrome, then `google-chrome --version | ... | grep -qi beta` last');
  const code = codeSteps();
  const norm = (arr) => arr.join(' | ').replace(/run-summary-beta-/g, 'run-summary-').replace(/test-artifacts-beta-/g, 'test-artifacts-');
  assert.equal(norm(rest), code.join(' | '), 'after the install step, test-beta runs exactly ci.yml\'s steps (artifact names aside)');
});

test('the two test jobs never upload the same artifact name, and no new action is introduced', () => {
  const text = weekly();
  const names = [...text.matchAll(/^\s+name: ((?:run-summary|test-artifacts)-.+?)\s*$/gm)].map((m) => m[1]);
  assert.equal(names.length, 4, 'two uploads in each of the two test jobs');
  assert.equal(new Set(names).size, 4, 'upload-artifact v4 fails the second upload of a name');
  const known = new Set([...ci().matchAll(/\buses: (\S+)/g)].map((m) => m[1]));
  for (const m of text.matchAll(/\buses: (\S+)/g)) assert.ok(known.has(m[1]), `${m[1]} must be a ref ci.yml already uses, copied verbatim`);
});
