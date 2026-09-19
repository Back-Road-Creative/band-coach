// Every test file must be reachable from an npm script. The `test` script
// lists its directories by hand (so the release gate can run separately),
// which means a new test directory is silently skipped until it is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const globs = `${scripts.test} ${scripts.gate}`.match(/tests[^"\s]*\*\.test\.mjs/g) || [];
const covered = new Set(globs.map((g) => dirname(g)));

function testDirs(dir, out = new Set()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) testDirs(join(dir, e.name), out);
    else if (e.name.endsWith('.test.mjs')) out.add(relative(root, dir));
  }
  return out;
}

test('every directory holding a test file is run by the test or gate script', () => {
  const missing = [...testDirs(join(root, 'tests'))].filter((d) => !covered.has(d));
  assert.deepEqual(missing, [], `add these to package.json scripts: ${missing.join(', ')}`);
});
