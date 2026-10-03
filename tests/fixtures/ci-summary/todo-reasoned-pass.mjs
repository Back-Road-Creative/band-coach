// Run by tests/unit/ci-run-summary.test.mjs as a live `node --test` child; not *.test.mjs, so no glob picks it up.
import { test } from 'node:test';
test('known bug that now passes', { todo: 'F1: fix not landed' }, () => {});
