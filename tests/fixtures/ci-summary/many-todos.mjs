// Run by tests/unit/ci-run-summary.test.mjs as a live `node --test` child; not *.test.mjs, so no glob picks it up.
import { test } from 'node:test';
for (let i = 0; i < 80; i++) test.todo('declared but not written ' + i);
