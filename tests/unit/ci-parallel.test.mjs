import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSelection, aggregateResults } from '../../build/ci-plan.mjs';

const all = ['test:root', 'test:build', 'test:char', 'test:unit'];
const sha = 'a'.repeat(40);
const result = (selection) => ({
  verdict: 'READY', selection, facts: { sha },
  steps: { gate: { rc: 0, outcome: 'success' }, suite: { rc: 0, outcome: 'success' } },
  releaseRun: selection.includes('test:release') ? 'ran' : 'not run (narrow selection)',
});
const evaluate = (plan, overrides = {}) => aggregateResults({
  planResult: 'success', plan, sha,
  developmentResult: plan.development.length ? 'success' : 'skipped',
  releaseResult: plan.release ? 'success' : 'skipped',
  development: plan.development.length ? result(plan.development) : null,
  release: plan.release ? result(['test:release']) : null,
  ...overrides,
});

test('full selection covers every family once in independent development/release jobs', () => {
  assert.deepEqual(planSelection(['test:all']), { development: all, release: true });
});
test('a narrow PR keeps its selected coverage and does not invent release work', () => {
  assert.deepEqual(planSelection(['test:unit', 'test:build']), {
    development: ['test:build', 'test:unit'], release: false,
  });
  assert.deepEqual(planSelection(['test:release']), { development: [], release: true });
});
test('empty selection widens to full; invalid family names cannot become shell commands', () => {
  assert.deepEqual(planSelection([]), planSelection(['test:all']));
  for (const selection of [['test:bad'], ['test:unit; echo injected'], ['test:all', 'bad']]) {
    assert.throws(() => planSelection(selection), /unknown/);
  }
});
test('aggregate accepts complete successful full and narrow runs', () => {
  for (const selected of [['test:all'], ['test:unit'], ['test:release']]) {
    assert.equal(evaluate(planSelection(selected)).verdict, 'READY');
  }
});
test('a failure, cancellation or missing selected job cannot become a green aggregate', () => {
  const plan = planSelection(['test:all']);
  for (const key of ['planResult', 'developmentResult', 'releaseResult']) {
    for (const status of ['failure', 'cancelled', 'skipped', '', undefined]) {
      assert.equal(evaluate(plan, { [key]: status }).verdict, 'NOT READY', `${key}: ${status}`);
    }
  }
});
test('aggregate requires summaries from the selected candidate and exact family set', () => {
  const plan = planSelection(['test:all']);
  for (const bad of [null, {}, result(['test:unit']), { ...result(all), facts: { sha: 'b'.repeat(40) } },
    { ...result(all), verdict: 'NOT READY' },
    { ...result(all), steps: { gate: { rc: 1, outcome: 'failure' }, suite: { rc: 0, outcome: 'success' } } },
    { ...result(all), steps: { gate: { rc: 0, outcome: 'success' }, suite: { rc: 1, outcome: 'failure' } } }]) {
    assert.equal(evaluate(plan, { development: bad }).verdict, 'NOT READY');
  }
  assert.equal(evaluate(plan, { release: { ...result(['test:release']), releaseRun: 'missing' } }).verdict, 'NOT READY');
});
test('an unselected job must be skipped; malformed/empty plans fail closed', () => {
  const plan = planSelection(['test:unit']);
  assert.equal(evaluate(plan, { releaseResult: 'failure' }).verdict, 'NOT READY');
  for (const invalid of [null, {}, { development: [], release: false }, { development: ['test:all'], release: false }]) {
    assert.equal(evaluate(plan, { plan: invalid }).verdict, 'NOT READY');
  }
});

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
function job(name) {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm').exec(workflow);
  assert.ok(m, `missing job ${name}`);
  return m[1];
}
test('development and release wait only for the plan and use separate hosted jobs', () => {
  for (const name of ['development', 'release']) {
    const body = job(name);
    assert.match(body, /needs: plan\b/);
    assert.doesNotMatch(body, /needs:.*(?:development|release)/);
    assert.match(body, /runs-on: ubuntu-latest/);
    assert.match(body, /github\.event\.repository\.private == false/);
  }
});
test('full development coverage keeps one native runner without its release posttest', (t) => {
  assert.match(job('development'), /npm --ignore-scripts test/);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.pretest, 'npm run build', 'update the explicit CI build if pretest gains another prerequisite');
  const dir = mkdtempSync(join(tmpdir(), 'bc-npm-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
    pretest: 'node -e "process.exit(91)"',
    test: 'node -e "console.log(\'DEVELOPMENT_RAN\')"',
    posttest: 'node -e "process.exit(92)"',
  } }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync('npm', ['--ignore-scripts', 'test'], {
    cwd: dir, env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /DEVELOPMENT_RAN/);
});
test('one final test check always evaluates all selected job results', () => {
  const body = job('test');
  assert.match(body, /needs: \[plan, development, release\]/);
  assert.match(body, /always\(\)/);
  assert.match(body, /node build\/ci-plan\.mjs aggregate/);
  for (const name of ['plan', 'development', 'release']) assert.match(body, new RegExp(`needs\\.${name}\\.result`));
});
test('release shell builds its development fixture in isolation and stops on build failure', (t) => {
  const body = job('release');
  const suite = body.split('      - id: suite\n')[1].split('      - name: summarise')[0];
  const script = suite.split('        run: |\n')[1].replace(/^          /gm, '');
  const dir = mkdtempSync(join(tmpdir(), 'bc-release-prerequisite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const npm = join(dir, 'npm');
  writeFileSync(npm, `#!/bin/bash
if [ "$*" = "run build" ]; then
  [ "\${FAIL_BUILD:-0}" = 0 ] || exit 71
  touch "$RUNNER_TEMP/development-html"
elif [ "$*" = "run test:release" ]; then
  touch "$RUNNER_TEMP/release-started"
  [ -f "$RUNNER_TEMP/development-html" ] || exit 72
else
  exit 73
fi
`, { mode: 0o755 });
  for (const fail of ['0', '1']) {
    for (const file of ['development-html', 'release-started']) rmSync(join(dir, file), { force: true });
    const run = spawnSync('bash', ['-c', script], {
      cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, FAIL_BUILD: fail },
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(run.status, fail === '0' ? 0 : 71, run.stderr);
    assert.equal(existsSync(join(dir, 'release-started')), fail === '0');
    assert.equal(readFileSync(join(dir, 'suite.rc'), 'utf8').trim(), fail === '0' ? '0' : '71');
  }
});
test('no new paid runner, cache, or summary artifacts are introduced', () => {
  assert.equal((workflow.match(/runs-on:/g) || []).length, 4);
  assert.equal((workflow.match(/runs-on: ubuntu-latest/g) || []).length, 4);
  assert.equal((workflow.match(/github\.event\.repository\.private == false/g) || []).length, 4);
  assert.equal((workflow.match(/name: run-summary-/g) || []).length, 1);
  assert.doesNotMatch(workflow, /actions\/cache@|--test-concurrency=\d/);
});

test('real CLI emits a plan and blocks missing evidence while saving the aggregate report', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-parallel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../../build/ci-plan.mjs', import.meta.url));
  const env = { ...process.env, GITHUB_OUTPUT: join(dir, 'outputs'), GITHUB_SHA: sha,
    GITHUB_EVENT_NAME: 'push', GITHUB_STEP_SUMMARY: join(dir, 'summary') };
  delete env.NODE_TEST_CONTEXT;
  const run = (mode, extra = {}) => spawnSync(process.execPath, [cli, mode], {
    cwd: dir, encoding: 'utf8', env: { ...env, ...extra }, timeout: 10000,
  });
  assert.equal(run('plan').status, 0);
  const plan = JSON.parse(readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().slice(5));
  assert.deepEqual(plan, planSelection(['test:all']));
  const failure = run('aggregate', { PLAN: JSON.stringify(plan), PLAN_RESULT: 'success' });
  assert.equal(failure.status, 1, failure.stderr);
  assert.ok(existsSync(join(dir, 'dist/test-artifacts/run-summary.json')));
  const pass = run('aggregate', { PLAN: JSON.stringify(plan), PLAN_RESULT: 'success',
    DEVELOPMENT_RESULT: 'success', RELEASE_RESULT: 'success',
    DEVELOPMENT_REPORT: JSON.stringify(result(all)), RELEASE_REPORT: JSON.stringify(result(['test:release'])),
  });
  assert.equal(pass.status, 0, pass.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'dist/test-artifacts/run-summary.json')));
  assert.equal(report.verdict, 'READY');
  // report mode must emit parseable compact JSON for GitHub job outputs.
  writeFileSync(join(dir, 'dist/test-artifacts/run-summary.json'), JSON.stringify({
    ...result(['test:release']), reasons: [], steps: {
      gate: { rc: 0, outcome: 'success', blocks: [] }, suite: { rc: 0, outcome: 'success', blocks: [] },
    },
  }));
  assert.equal(run('report').status, 0);
  const line = readFileSync(env.GITHUB_OUTPUT, 'utf8').split('\n').find((s) => s.startsWith('report='));
  assert.equal(JSON.parse(line.slice(7)).facts.sha, sha);
});
