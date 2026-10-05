// The src/core coverage floor (tests/unit/coverage-floor.mjs, run by
// `npm run coverage`): reading an lcov report, summing only src/core, and
// failing when the number drops below the floor or the report has no src/core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COVERAGE_FLOOR_PERCENT, lineCoverageUnder, checkFloor, prepareReportDir } from './coverage-floor.mjs';

const lcov = (files) => files.map(([sf, lf, lh]) => `TN:\nSF:${sf}\nDA:1,1\nLF:${lf}\nLH:${lh}\nend_of_record\n`).join('');

test('lineCoverageUnder sums LF and LH across src/core files only', () => {
  const report = lcov([['src/core/a.js', 10, 9], ['src/core/ear/b.js', 10, 5], ['src/song/c.js', 100, 0], ['src/audio/d.js', 50, 50]]);
  assert.deepEqual(lineCoverageUnder(report, 'src/core'), { found: 20, hit: 14, percent: 70 });
});

test('absolute paths and Windows separators count; a look-alike directory does not', () => {
  const report = lcov([['/work/band-coach/src/core/a.js', 4, 4], ['C:\\work\\band-coach\\src\\core\\b.js', 4, 0], ['src/core-extra/c.js', 100, 0], ['src/song/core/d.js', 100, 0]]);
  assert.deepEqual(lineCoverageUnder(report, 'src/core'), { found: 8, hit: 4, percent: 50 });
});

test('a report with no src/core file has no percentage', () => {
  assert.deepEqual(lineCoverageUnder(lcov([['src/song/a.js', 5, 5]]), 'src/core'), { found: 0, hit: 0, percent: null });
  assert.deepEqual(lineCoverageUnder('', 'src/core'), { found: 0, hit: 0, percent: null });
});

test('checkFloor passes at exactly the floor and above it', () => {
  assert.equal(checkFloor(lcov([['src/core/a.js', 100, 80]]), 80).ok, true);
  assert.equal(checkFloor(lcov([['src/core/a.js', 100, 95]]), 80).ok, true);
});

test('checkFloor fails below the floor and says the numbers', () => {
  const r = checkFloor(lcov([['src/core/a.js', 100, 79]]), 80);
  assert.equal(r.ok, false);
  assert.match(r.message, /79\.00%/);
  assert.match(r.message, /79\/100/);
  assert.match(r.message, /floor of 80%/);
});

test('checkFloor fails, not passes, when the report has no src/core files', () => {
  const r = checkFloor(lcov([['src/song/a.js', 5, 5]]), 80);
  assert.equal(r.ok, false);
  assert.match(r.message, /cannot be checked/);
});

// Ratchet: the floor is the measured src/core line coverage rounded down (98.75% -> 98).
// Lowering it needs an edit here too, so it shows in review; raise both when coverage rises.
test('the committed floor is a whole percentage at the measured 98, never lowered quietly', () => {
  assert.ok(Number.isInteger(COVERAGE_FLOOR_PERCENT));
  assert.ok(COVERAGE_FLOOR_PERCENT >= 98 && COVERAGE_FLOOR_PERCENT <= 100, 'floor ' + COVERAGE_FLOOR_PERCENT);
});

test('run as a script: exit 0 above the floor, 1 below it, 1 for a missing report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cov-floor-'));
  try {
    const script = fileURLToPath(new URL('./coverage-floor.mjs', import.meta.url));
    const good = join(dir, 'good.info');
    const bad = join(dir, 'bad.info');
    writeFileSync(good, lcov([['src/core/a.js', 100, 100]]));
    writeFileSync(bad, lcov([['src/core/a.js', 100, 1]]));
    assert.equal(spawnSync(process.execPath, [script, good]).status, 0);
    const low = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
    assert.equal(low.status, 1);
    assert.match(low.stdout, /below the floor/);
    assert.equal(spawnSync(process.execPath, [script, join(dir, 'nope.info')]).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the wiring: npm script and the weekly workflow ----
const root = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url));

test('prepareReportDir makes the folder (nested too) and a catch-all .gitignore in it, and can run twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cov-prep-'));
  try {
    const target = join(dir, 'a', 'coverage');
    prepareReportDir(target);
    prepareReportDir(target);
    assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), '*\n');
    const script = fileURLToPath(new URL('./coverage-floor.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--prepare', 'fresh'], { cwd: dir });
    assert.equal(run.status, 0);
    assert.equal(readFileSync(join(dir, 'fresh', '.gitignore'), 'utf8'), '*\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npm run coverage prepares its report folder first, reports src/core, src/song and src/audio, writes lcov and then runs the floor', () => {
  const cmd = JSON.parse(readFileSync(root('package.json'), 'utf8')).scripts.coverage;
  assert.ok(cmd, 'package.json must have a coverage script');
  // Node does not create the folder of --test-reporter-destination: on a fresh checkout the run dies with ENOENT.
  // Done by a node script, not `mkdir -p`, so the script also runs on Windows; it also keeps the folder out of git.
  assert.ok(cmd.startsWith('node tests/unit/coverage-floor.mjs --prepare coverage && node --test '), 'the coverage folder must be made before the test run');
  assert.match(cmd, /--experimental-test-coverage/);
  for (const dir of ['src/core', 'src/song', 'src/audio']) assert.ok(cmd.includes('--test-coverage-include="' + dir + '/**"'), dir + ' must be included');
  assert.match(cmd, /--test-reporter=lcov --test-reporter-destination=coverage\/lcov\.info/);
  assert.match(cmd, /"tests\/unit\/\*\.test\.mjs"/);
  assert.match(cmd, /"tests\/unit\/notation\/\*\.test\.mjs"/, 'the floor was measured with the notation tests included');
  assert.match(cmd, /&& node tests\/unit\/coverage-floor\.mjs coverage\/lcov\.info$/, 'the floor must run last, on the report just written');
});

test('the weekly coverage workflow runs on a schedule and by hand only, read-only, and keeps the lcov file', () => {
  const file = root('.github/workflows/coverage.yml');
  assert.ok(existsSync(file), '.github/workflows/coverage.yml must exist');
  const yml = readFileSync(file, 'utf8');
  const on = /^on:\n((?: .*\n|\n)*)/m.exec(yml)[1];
  assert.match(on, /^ {2}schedule:/m);
  assert.match(on, /^ {2}workflow_dispatch:/m);
  assert.doesNotMatch(on, /push|pull_request/, 'a push or PR trigger would add runs the merge barrier could count');
  assert.match(yml, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(yml, /contents: write/);
  assert.match(yml, /run: node build\/build\.mjs\n[\s\S]*run: npm run coverage/, 'some unit tests read the built page, so build first');
  assert.match(yml, /uses: actions\/upload-artifact@[0-9a-f]{40} /, 'actions are pinned to a commit, as in every other workflow');
  assert.match(yml, /path: coverage\/lcov\.info/);
});
