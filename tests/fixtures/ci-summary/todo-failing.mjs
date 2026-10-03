// Run by tests/unit/ci-run-summary.test.mjs as a live `node --test` child; not *.test.mjs, so no glob picks it up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('known bug still red', { todo: 'F9: still red' }, () => { assert.fail('still red'); });
