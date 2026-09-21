// The boot deadline failure has to be tellable apart from every other error.
//
// `retryFlaky` aborts immediately on a thrown error, on purpose: a crash is
// not a flake, and retrying one would hide a real break. But the boot deadline
// IS the flake -- `launchPage` throws it when a starved runner cannot finish
// booting the page inside the budget, and that is exactly the case worth a
// fresh attempt.
//
// So a caller needs to catch that one error and re-throw everything else. Doing
// that by matching the message text would make the wording load-bearing: reword
// the message and the retry silently stops working, with no test failing. A
// code on the error is the thing to match instead, and these tests pin it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOT_DEADLINE_CODE,
  BOOT_DEADLINE_MS,
  bootDeadlineError,
} from '../helpers/browser.mjs';

test('the boot deadline error carries a stable code', () => {
  const err = bootDeadlineError(1234);
  assert.ok(err instanceof Error, 'it must be a real Error so stacks and rethrows behave');
  assert.equal(err.code, BOOT_DEADLINE_CODE);
  assert.equal(
    BOOT_DEADLINE_CODE,
    'BOOT_DEADLINE',
    'the code is matched by callers, so changing it is a breaking change',
  );
});

test('the message still names the deadline it missed', () => {
  const err = bootDeadlineError(1234);
  assert.match(err.message, /1234ms/, 'a reader needs to know which budget was blown');
  assert.match(
    err.message,
    /data-coach-ready/,
    'and which condition never became true, so the message stays diagnostic',
  );
});

test('the code is what distinguishes it, not the wording', () => {
  const boot = bootDeadlineError(BOOT_DEADLINE_MS);
  const other = new Error('the page never finished booting -- but for some other reason');
  assert.equal(boot.code, BOOT_DEADLINE_CODE);
  assert.equal(
    other.code,
    undefined,
    'an error that merely reads similarly must not be mistaken for the boot deadline',
  );
});
