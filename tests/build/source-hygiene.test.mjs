// finishTask has exactly one definition: a second `finishTask = ...` wrapper
// hid the real body behind a later reassignment.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

test('finishTask is defined once in src/app.js', () => {
  const src = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
  const assigns = src.match(/\bfinishTask\s*=(?!=)|\b(?:let|const|var)\s+finishTask\b|function\s+finishTask\b/g) || [];
  assert.equal(assigns.length, 1, 'finishTask assigned ' + assigns.length + ' times: ' + assigns.join(' | '));
});

