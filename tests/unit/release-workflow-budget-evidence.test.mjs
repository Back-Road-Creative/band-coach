// release.yml is the tag run: it gates the file it publishes. Pins here keep
// four things from drifting, none of which a PR run can exercise (no PR run
// executes release.yml; the first run of any edit is the next `v*` tag):
//   - its time budget is at least ci.yml's, because it runs the same work;
//   - the gate is the last step before publish, so the published file is the
//     one the gate built and tested;
//   - the browser version is recorded;
//   - a failed or cancelled run keeps dist/test-artifacts/.
// No YAML parser is installed, so the steps are split by indentation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function workflow(name) {
  const path = fileURLToPath(new URL('../../.github/workflows/' + name, import.meta.url));
  return readFileSync(path, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
}

function scalar(step, key) {
  const lines = step.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp('^(?: {6}- | {8})' + key + ':[ \\t]*(.*)$'));
    if (!m) continue;
    let value = m[1].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^ {9,}\S/.test(lines[j])); j++) block.push(lines[j].trim());
      return block.join('\n').trim();
    }
    return value.replace(/^'(.*)'$/s, '$1');
  }
  return '';
}

function steps(text) {
  const at = text.search(/^ {4}steps:[ \t]*$/m);
  assert.notEqual(at, -1, 'no `    steps:` line found');
  const body = text.slice(at).split('\n').slice(1).join('\n');
  return body.split(/\n(?= {6}- )/).filter((s) => /^ {6}- /.test(s)).map((text) => ({
    text, name: scalar(text, 'name'), run: scalar(text, 'run'), uses: scalar(text, 'uses'),
  }));
}

const release = workflow('release.yml');
const all = steps(release);
const at = (pred) => all.findIndex(pred);
const named = (n) => at((s) => s.name === n);
const timeouts = (text) => [...text.matchAll(/^\s+timeout-minutes:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));

test('T0 the parser sees the release workflow', () => {
  const names = all.map((s) => s.name).filter(Boolean);
  for (const n of ['locate Chrome', 'tag must match package.json version', 'publish GitHub release', 'check for HEADLESSMODE_DISPATCH_TOKEN', 'Notify the Headless Mode site']) {
    assert.ok(names.includes(n), `step "${n}" not found among: ${names.join(' | ')}`);
  }
  assert.ok(all.length >= 9, `expected at least 9 steps, parsed ${all.length}`);
});

test('T1 the tag run budget is at least ci.yml budget, which runs the same work', () => {
  const rel = timeouts(release);
  const ci = timeouts(workflow('ci.yml'));
  assert.equal(rel.length, 1, `release.yml should have exactly one timeout-minutes, found ${rel.length}`);
  assert.ok(ci.length >= 1, 'ci.yml has no timeout-minutes');
  assert.ok(rel[0] >= Math.max(...ci), `release.yml allows ${rel[0]} min but ci.yml allows ${Math.max(...ci)} min for the same suite and gate runs; a later ci.yml rise must be followed here`);
});

test('T2 the workflow keeps its name and tag trigger and has no manual trigger', () => {
  assert.match(release, /^name: release$/m, 'release-consistency.yml fires on workflow_run of "release"');
  assert.match(release, /tags:\s*\n\s*- 'v\*'/, 'release.yml should run on v* tags');
  // release-consistency.yml treats every successful "release" run as a published tag, so a manual trigger needs its own guards first.
  assert.doesNotMatch(release, /workflow_dispatch/, 'a manual trigger would let a run that published nothing read as a release');
});

test('T3 the gate is the last step before publish', () => {
  const tests = all.map((s, i) => [s, i]).filter(([s]) => /\bnpm test\b/.test(s.run));
  const gates = all.map((s, i) => [s, i]).filter(([s]) => /\bnpm run gate\b/.test(s.run));
  assert.equal(tests.length, 1, `expected one npm test step, found ${tests.length}`);
  assert.equal(gates.length, 1, `expected one npm run gate step, found ${gates.length}`);
  for (const [s] of [tests[0], gates[0]]) assert.match(s.text, /\n\s+env:\s*\n\s+CI: true\b/, `"${s.run}" must run with CI: true`);
  const pub = named('publish GitHub release');
  assert.ok(tests[0][1] < gates[0][1], 'the gate must come after npm test');
  assert.equal(pub, gates[0][1] + 1, `publish is step ${pub}, the gate is step ${gates[0][1]}: no step may run between them`);
});

test('T4 publish uploads the gate file and nothing else creates a release', () => {
  const pub = all[named('publish GitHub release')];
  assert.ok(pub, 'no publish step');
  assert.match(pub.run, /gh release create\s+"\$GITHUB_REF_NAME"\s+dist\/release\/band-coach\.html(\s|\\)/);
  const others = all.filter((s) => s !== pub && /gh release create/.test(s.run));
  assert.equal(others.length, 0, 'only the publish step may create a release');
});

test('T5 the Chrome version is recorded after the guard and before the install', () => {
  const rec = all.filter((s) => s.name === 'record Chrome version');
  assert.equal(rec.length, 1, `expected one "record Chrome version" step, found ${rec.length}`);
  assert.ok(rec[0].run.includes('"$CHROME_BIN" --version'), 'it must run the located browser with --version');
  assert.ok(rec[0].run.includes('>> "$GITHUB_STEP_SUMMARY"'), 'it must write to the step summary');
  const order = [named('locate Chrome'), named('tag must match package.json version'), named('record Chrome version'), at((s) => s.run === 'npm ci')];
  assert.ok(order.every((i) => i >= 0), `a step is missing: ${order.join(',')}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `order must be locate Chrome < guard < record Chrome version < npm ci, got indexes ${order.join(',')}`);
});

test('T6 a failed or cancelled run uploads its test artifacts as the last step', () => {
  const ups = all.filter((s) => /^actions\/upload-artifact@/.test(s.uses));
  assert.equal(ups.length, 1, `expected one upload-artifact step, found ${ups.length}`);
  const up = ups[0];
  assert.equal(up, all[all.length - 1], 'the upload must be the last step so it sees every earlier failure');
  assert.equal(up.uses, 'actions/upload-artifact@v4');
  assert.equal(scalar(up.text, 'if'), 'failure() || cancelled()');
  assert.match(up.text, /^ {10}path: dist\/test-artifacts\/$/m);
  assert.match(up.text, /^ {10}if-no-files-found: ignore$/m);
  assert.match(up.text, /^ {10}name: test-artifacts-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/m);
  const days = up.text.match(/^ {10}retention-days: (\d+)$/m);
  assert.ok(days && Number(days[1]) >= 1 && Number(days[1]) <= 14, 'retention-days must be an integer from 1 to 14');
});
