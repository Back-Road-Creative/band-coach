// ci.yml triggers on push to main AND pull_request, with one concurrency group
// per ref. With `cancel-in-progress: true`, a second quick push to main cancelled
// the first main run, leaving a main commit with no completed CI (and no
// integration barrier for bin/autoland.py to read). Only superseded PR runs
// should be cancelled; a main run is always allowed to finish.
// Asserting on the workflow's text: a workflow cannot be imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ci = readFileSync(`${ROOT}.github/workflows/ci.yml`, 'utf8');
const block = ci.match(/^concurrency:\n((?:[ \t]+.*\n)+)/m);

test('ci.yml has a top-level concurrency block', () => {
  assert.ok(block, 'concurrency block not found');
});

test('cancel-in-progress is not the literal true', () => {
  const m = block[1].match(/^\s*cancel-in-progress:\s*(.+?)\s*$/m);
  assert.ok(m, 'cancel-in-progress not set');
  assert.notEqual(m[1], 'true');
});

test('cancel-in-progress is conditioned on pull_request only', () => {
  const m = block[1].match(/^\s*cancel-in-progress:\s*(.+?)\s*$/m);
  assert.match(m[1], /^\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}$/);
});
