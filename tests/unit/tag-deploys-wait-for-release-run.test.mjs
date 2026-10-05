// A `v*` tag fires release.yml, pages.yml and store-package.yml at once. Only
// release.yml runs the test suite and the release gate, so before this pin a
// tag on a red commit still deployed GitHub Pages (which every web user and
// the version.json update check read) and still packaged a Store .appx.
//
// pages.yml and store-package.yml now start with a `release-gate` job that
// waits for the release.yml run for the SAME commit to finish, and fails
// unless it succeeded. The deploy / package job needs it. This test pins the
// wiring and runs the waiting script itself against a fake `gh`, so a wrong
// verdict (a failed run read as a pass, an unfinished run read as a pass) is
// caught here and not on the next tag. No YAML parser is installed, so the
// jobs and steps are split by indentation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = '1874d63f13d5c4777aaee7e872cf126460644b7c';
const GATED = [
  { file: 'pages.yml', job: 'deploy' },
  { file: 'store-package.yml', job: 'package' },
];

function workflow(name) {
  return readFileSync(fileURLToPath(new URL('../../.github/workflows/' + name, import.meta.url)), 'utf8');
}

function job(text, name) {
  const at = text.search(new RegExp('^  ' + name + ':[ \\t]*$', 'm'));
  assert.notEqual(at, -1, `no job named ${name}`);
  const rest = text.slice(at).split('\n').slice(1);
  const end = rest.findIndex((l) => /^ {2}\S/.test(l));
  return [text.slice(at).split('\n')[0], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

function waitStep(file) {
  const block = job(workflow(file), 'release-gate');
  const at = block.search(/^ {6}- name: wait for release\.yml/m);
  assert.notEqual(at, -1, `${file}: release-gate has no "wait for release.yml" step`);
  const rest = block.slice(at).split('\n');
  const end = rest.findIndex((l, i) => i > 0 && /^ {6}- /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

function script(file) {
  const lines = waitStep(file).split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|[ \t]*$/.test(l));
  assert.notEqual(at, -1, `${file}: the wait step has no literal block script`);
  const body = [];
  for (let i = at + 1; i < lines.length && (lines[i].trim() === '' || /^ {10}/.test(lines[i])); i++) body.push(lines[i].slice(10));
  return body.join('\n');
}

for (const { file, job: gated } of GATED) {
  test(`${file}: ${gated} needs a release-gate job that reads release.yml's run for this commit`, () => {
    const text = workflow(file);
    const gate = job(text, 'release-gate');
    assert.match(gate, /runs-on: ubuntu-latest/, 'gh is on the Linux runner; the gate must not depend on the job OS');
    assert.match(gate, /actions: read/, 'listing workflow runs needs actions: read');
    const needs = job(text, gated).match(/^ {4}needs:[ \t]*(.*)$/m);
    assert.ok(needs, `${file}: ${gated} has no needs`);
    assert.match(needs[1], /\brelease-gate\b/, `${file}: ${gated} must wait for release-gate`);
    const step = waitStep(file);
    assert.match(step, /if: github\.ref_type == 'tag'/, 'a manual run on a branch has no tag run to wait for');
    const sh = script(file);
    assert.match(sh, /--workflow release\.yml/, 'must read the release.yml runs');
    assert.match(sh, /--commit "\$GITHUB_SHA"/, 'must be the run for THIS commit, not any recent run');
  });
}

test('release.yml still runs the suite and the gate that pages and the store now wait for', () => {
  const text = workflow('release.yml');
  const rel = job(text, 'release');
  assert.match(rel, /- run: npm test$/m);
  assert.match(rel, /- run: npm run gate$/m);
  assert.match(text, /^name: release$/m, 'pages.yml and store-package.yml look the run up as release.yml');
});

// Runs the real script against a fake gh and a fake sleep. `answers` is a list
// of what successive `gh run list` calls print; the last repeats. An entry of
// null makes that call exit 1, as when the API is briefly unreachable.
function run(file, answers) {
  const dir = mkdtempSync(join(tmpdir(), 'bc-gate-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers));
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
echo "$*" >> "${dir}/gh-calls"
n=$(wc -l < "${dir}/gh-calls")
node -e '
  const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const r = a[Math.min(Number(process.argv[2]) - 1, a.length - 1)];
  if (r === null) process.exit(1);
  process.stdout.write(JSON.stringify(r));
' "${dir}/answers.json" "$n"
`);
  writeFileSync(join(bin, 'sleep'), `#!/usr/bin/env bash\necho "$1" >> "${dir}/sleeps"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);
  writeFileSync(join(dir, 'step.sh'), script(file));
  const r = spawnSync('bash', ['-e', join(dir, 'step.sh')], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x' },
    encoding: 'utf8',
  });
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n') : []);
  return { rc: r.status, out: r.stdout + r.stderr, calls: read('gh-calls'), sleeps: read('sleeps') };
}

const ok = { status: 'completed', conclusion: 'success' };
const bad = { status: 'completed', conclusion: 'failure' };
const going = { status: 'in_progress', conclusion: '' };

for (const { file } of GATED) {
  test(`${file}: a successful release run for the commit lets the deploy proceed`, () => {
    const r = run(file, [[ok]]);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.calls.length, 1);
    assert.match(r.calls[0], /--commit 1874d63f13d5c4777aaee7e872cf126460644b7c/);
    assert.match(r.calls[0], /--workflow release\.yml/);
  });

  test(`${file}: a failed release run blocks the deploy and says why`, () => {
    const r = run(file, [[bad]]);
    assert.notEqual(r.rc, 0, 'a red tag run must not let the deploy through');
    assert.match(r.out, /release\.yml/);
    assert.equal(r.sleeps.length, 0, 'a finished failure is final; do not keep waiting');
  });

  test(`${file}: a release run still going is waited for, not treated as a pass`, () => {
    const r = run(file, [[going], [going], [ok]]);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.calls.length, 3);
    assert.equal(r.sleeps.length, 2);
  });

  test(`${file}: a run that ends red after being waited for blocks the deploy`, () => {
    const r = run(file, [[going], [bad]]);
    assert.notEqual(r.rc, 0);
  });

  test(`${file}: no release run ever appearing for the commit blocks the deploy`, () => {
    const r = run(file, [[]]);
    assert.notEqual(r.rc, 0, 'with no test run on record the deploy must not go ahead');
    assert.ok(r.sleeps.length >= 10, 'a run that has not started yet is given time to appear');
  });

  test(`${file}: a brief gh/API failure is retried, not read as a pass or a fail`, () => {
    const r = run(file, [null, [ok]]);
    assert.equal(r.rc, 0, r.out);
  });
}
