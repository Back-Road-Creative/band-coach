// Run by tests/unit/retry-flaky.test.mjs as `node --test <this file>`: the first
// measurement is wrong, the second right. Not *.test.mjs, so no glob picks it up.
import { test } from 'node:test';
import { retryFlaky } from '../../helpers/browser.mjs';

test('measurement that is wrong once', async () => {
  await retryFlaky({
    what: 'the pitch spread',
    attempt: (i) => ({ spreadCents: i === 0 ? 47 : 3 }),
    accept: (r) => r.spreadCents < 10,
    describe: (r) => `spread ${r.spreadCents} cents`,
  });
});
