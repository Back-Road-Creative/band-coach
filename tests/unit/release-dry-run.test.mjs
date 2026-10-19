// release.yml also runs on workflow_dispatch so the whole release path (build,
// npm test with its posttest release lane, the tested-file hash) can be
// exercised on main without a tag. A dispatch run must publish nothing and
// notify nobody, and must not look like a release to the workflows that wait
// on it. No YAML parser is installed, so steps are split by indentation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const wf = (n) => readFileSync(fileURLToPath(new URL('../../.github/workflows/' + n, import.meta.url)), 'utf8');
const release = wf('release.yml');
const TAG_ONLY = "github.event_name == 'push' && github.ref_type == 'tag'";

const stepsText = release.slice(release.search(/^ {4}steps:[ \t]*$/m)).split('\n').slice(1).join('\n');
const steps = stepsText.split(/\n(?= {6}- )/).filter((s) => /^ {6}- /.test(s));
const find = (name) => {
  const s = steps.find((x) => x.includes('- name: ' + name));
  assert.ok(s, `no step named "${name}"`);
  return s;
};
const ifLine = (s) => (s.match(/^ {8}if: (.*)$/m) || [])[1] || '';

test('release.yml has a workflow_dispatch trigger beside the tag push', () => {
  assert.match(release, /^on:\n(?:  .*\n)*?  workflow_dispatch:/m);
  assert.match(release, /tags:\s*\n\s*- 'v\*'/);
});

test('every step that needs a tag or has an outside effect runs only on a tag push', () => {
  for (const name of [
    'tag must match package.json version',
    'publish GitHub release',
    'prove the downloaded release file',
    'check for HEADLESSMODE_DISPATCH_TOKEN',
    'warn if the Headless Mode site will not be notified',
    'Notify the Headless Mode site',
  ]) {
    assert.ok(ifLine(find(name)).startsWith(TAG_ONLY), `"${name}" must start its if: with ${TAG_ONLY}, got: ${ifLine(find(name))}`);
  }
});

test('nothing that creates a release or dispatches elsewhere is left unguarded', () => {
  for (const s of steps) {
    if (/gh release (create|download)|\/dispatches|gh api/.test(s)) {
      assert.ok(ifLine(s).startsWith(TAG_ONLY), `unguarded outside-effect step:\n${s}`);
    }
  }
});

test('a dispatch run builds, tests and records the tested-file hash, and says what it would publish', () => {
  for (const name of ['record the hash of the file the release lane tested', 'ci.yml must have succeeded on this commit', 'acceptance record must name this candidate']) {
    assert.equal(ifLine(find(name)), '', `"${name}" must run on a dispatch too`);
  }
  assert.equal(ifLine(steps.find((s) => /run: npm test/.test(s))), '');
  const sum = find('summarise what a tag run would publish');
  assert.match(ifLine(sum), /github\.event_name == 'workflow_dispatch'/);
  assert.match(sum, /GITHUB_STEP_SUMMARY/);
  assert.match(sum, /tested\.sha256/);
});

test('SOURCE_DATE_EPOCH is pinned to the commit before the build, as ci.yml does', () => {
  const line = 'echo "SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)" >> "$GITHUB_ENV"';
  assert.ok(wf('ci.yml').includes(line));
  const at = release.indexOf(line);
  assert.notEqual(at, -1, 'release.yml does not set SOURCE_DATE_EPOCH');
  assert.ok(at < release.indexOf('run: npm test'), 'it must precede the build (npm test builds in posttest)');
  assert.ok(at > release.indexOf('actions/checkout@'), 'it needs the checkout');
  assert.match(release, /fetch-depth: 0/);
});

test('downstream workflows ignore a dispatch run of release.yml', () => {
  for (const f of ['pages.yml', 'store-package.yml']) {
    assert.match(wf(f), /--workflow release\.yml [^\n]*--event push /, `${f}: the release-gate must only count push runs`);
  }
  const rc = wf('release-consistency.yml');
  const check = rc.slice(rc.search(/^ {2}check:/m));
  assert.match(check, /^ {4}if: .*github\.event\.workflow_run\.event == 'push'/m, 'release-consistency must ignore workflow_run of a dispatch run');
  assert.match(check, /github\.event_name == 'workflow_dispatch' \|\|/, 'its own manual re-run stays');
});
