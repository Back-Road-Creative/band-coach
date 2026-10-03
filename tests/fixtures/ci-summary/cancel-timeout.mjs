// Run by tests/unit/ci-run-summary.test.mjs as a live `node --test` child; not *.test.mjs, so no glob picks it up.
// Run with --test-timeout=300: the file itself times out, so node prints one
// `not ok` for the file and none for the tests inside it.
import { test } from 'node:test';
test('resolves after five seconds', () => new Promise((resolve) => setTimeout(resolve, 5000)));
test('fast test after it', () => {});
