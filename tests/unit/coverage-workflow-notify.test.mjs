// A red coverage floor used to be silent: coverage.yml only runs weekly and by
// hand, so nobody watches it. This pins the notify job that opens (or updates)
// one issue when the coverage job fails, with `issues: write` on that job alone.
// Plain text, like the other workflow tests: there is no YAML dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const yml = readFileSync(fileURLToPath(new URL('../../.github/workflows/coverage.yml', import.meta.url)), 'utf8');
// The text of a top-level key's block, up to the next top-level key.
const top = (key) => new RegExp('^' + key + ':[^\\n]*\\n((?:[ \\t].*\\n|[ \\t]*\\n)*)', 'm').exec(yml)?.[1] ?? '';
// One job's block inside `jobs:`.
const job = (name) => new RegExp('^ {2}' + name + ':\\n((?: {4}.*\\n|[ \\t]*\\n)*)', 'm').exec(top('jobs'))?.[1] ?? '';

test('a notify job needs the coverage job and runs only when it failed', () => {
  const notify = job('notify');
  assert.ok(notify, 'coverage.yml must have a `notify` job');
  assert.match(notify, /^ {4}needs: \[?coverage\]?$/m);
  assert.match(notify, /^ {4}if: .*needs\.coverage\.result == 'failure'/m, 'it must key off needs.coverage.result: its own steps do not fail when the coverage job did');
  assert.match(notify, /gh issue create/);
  assert.match(notify, /gh issue comment/, 'a second red week updates the open issue instead of opening another');
});

test('issues: write is on the notify job only; the workflow stays read-only', () => {
  assert.doesNotMatch(top('permissions'), /issues/);
  assert.match(top('permissions'), /contents: read/);
  assert.match(job('notify'), /^ {6}issues: write$/m);
  assert.doesNotMatch(job('coverage'), /issues: write/);
  assert.equal((yml.match(/issues: write/g) || []).length, 1);
});

test('the notify job runs no checked-out code and uses no third-party action', () => {
  assert.match(job('notify'), /steps:/);
  assert.doesNotMatch(job('notify'), /uses:/);
});
