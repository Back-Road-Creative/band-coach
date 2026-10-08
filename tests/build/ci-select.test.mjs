// build/ci-select.mjs turns a PR's changed-file list into the family scripts CI
// runs. The contract that matters: a narrow selection is only ever chosen from a
// path the manifest positively recognises, and anything unknown or empty runs
// everything, so a mistake in the manifest costs time, never coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp, selectFamilies } from '../../build/ci-select.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'tests/families.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pick = (files) => selectFamilies(files, manifest);

test('a unit-only change (src/core, tests/unit) selects only test:unit', () => {
  assert.deepEqual(pick(['src/core/groove.js']), ['test:unit']);
  assert.deepEqual(pick(['tests/unit/groove.test.mjs', 'src/core/groove.js']), ['test:unit']);
});

test('a change to the build or the app shell selects the build and browser families, and the release', () => {
  const got = pick(['build/build.mjs']);
  for (const s of ['test:build', 'test:char', 'test:release']) assert.ok(got.includes(s) || got.includes('test:all'), `${s} in ${got}`);
  const app = pick(['src/app.js']);
  for (const s of ['test:build', 'test:char', 'test:release']) assert.ok(app.includes(s) || app.includes('test:all'), `${s} in ${app}`);
});

test('a test-only change selects just that family; a release test selects the release', () => {
  assert.deepEqual(pick(['tests/build/ci-select.test.mjs']), ['test:build']);
  assert.deepEqual(pick(['tests/release/gate.test.mjs']), ['test:release']);
});

test('an unknown path selects everything, even beside a recognised one', () => {
  assert.deepEqual(pick(['something/new.txt']), ['test:all']);
  assert.deepEqual(pick(['src/core/groove.js', 'README.md']), ['test:all']);
  assert.deepEqual(pick(['.github/workflows/ci.yml']), ['test:all']);
  assert.deepEqual(pick(['package.json']), ['test:all']);
});

test('empty or missing input selects everything', () => {
  assert.deepEqual(pick([]), ['test:all']);
  assert.deepEqual(pick(undefined), ['test:all']);
  assert.deepEqual(pick(['', '  ']), ['test:all']);
});

test('the CLI prints the selection on one line; no arguments and no diff means test:all', () => {
  const run = (...a) => spawnSync(process.execPath, ['build/ci-select.mjs', ...a], { cwd: root, encoding: 'utf8' });
  const r = run('src/core/groove.js');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'test:unit\n');
  assert.equal(run('nope/unknown.bin').stdout, 'test:all\n');
  // a base that git cannot resolve is not a reason to run less
  const bad = run('--base', 'no-such-ref-for-ci-select');
  assert.equal(bad.status, 0, bad.stderr);
  assert.equal(bad.stdout, 'test:all\n');
});

test('globToRegExp: ** crosses directories, * does not', () => {
  assert.ok(globToRegExp('src/core/**').test('src/core/a/b.js'));
  assert.ok(globToRegExp('tests/unit/*.test.mjs').test('tests/unit/a.test.mjs'));
  assert.ok(!globToRegExp('tests/unit/*.test.mjs').test('tests/unit/notation/a.test.mjs'));
});

test('the manifest names real package scripts and real globs, and covers every test directory once', () => {
  for (const [name, f] of Object.entries(manifest.families)) {
    assert.ok(pkg.scripts[f.script], `${name}: package.json has no script ${f.script}`);
    assert.equal(typeof f.needsBuild, 'boolean', `${name}.needsBuild`);
    assert.equal(typeof f.needsRelease, 'boolean', `${name}.needsRelease`);
    assert.ok(Array.isArray(f.globs) && f.globs.length, `${name}.globs`);
    for (const g of f.globs) assert.ok(pkg.scripts[f.script].includes(`"${g}"`) || pkg.scripts[f.script].includes(g), `${f.script} must run ${g}`);
  }
  assert.ok(pkg.scripts[manifest.all], 'the fallback script exists');
  for (const r of manifest.rules) for (const fam of r.run) assert.ok(manifest.families[fam], `rule runs unknown family ${fam}`);
  assert.ok(existsSync(join(root, 'build/ci-select.mjs')));
});

test('package.json: gate is an alias of test:release; npm test keeps its pre/post hooks and families', () => {
  assert.equal(pkg.scripts.gate, 'npm run test:release');
  assert.equal(pkg.scripts.pretest, 'npm run build');
  assert.equal(pkg.scripts.posttest, 'npm run gate');
  for (const g of ['tests/*.test.mjs', 'tests/build/*.test.mjs', 'tests/characterization/*.test.mjs', 'tests/unit/*.test.mjs', 'tests/unit/notation/*.test.mjs']) {
    assert.ok(pkg.scripts.test.includes(`"${g}"`), `npm test still runs ${g}`);
    assert.ok(pkg.scripts['test:all'].includes(`"${g}"`), `test:all runs ${g}`);
  }
  assert.ok(pkg.scripts['test:all'].includes('test:release'), 'test:all ends with the release family');
});
