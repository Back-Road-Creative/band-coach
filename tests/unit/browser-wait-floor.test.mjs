// Three different characterization tests went red on three consecutive full
// suite runs on 2026-09-20 — deaf-window, then a11y-dialog-focus, then
// w-history — and every one of them passed 3/3 when run solo immediately
// after. None was a defect: each had asked page.waitFor() for a few seconds
// and the box, running two other suites and a CI runner, had not got there
// yet. w-history's was the clearest: `waitFor timed out after 3000ms:
// …panels?.history?.learnerName === 'Ada'` for a localStorage write that is
// synchronous in the page.
//
// The asymmetry is the whole argument. A wait that is too LONG costs seconds,
// and only on a run that is failing anyway. A wait that is too SHORT marks
// correct code as broken, at random, and burns a CI round plus whoever has to
// read the log. So no call site is allowed to ask for less than the box may
// need: every requested timeout is floored, and a caller asking for MORE than
// the floor still gets what it asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWaitMs, WAIT_FLOOR_MS, BOOT_DEADLINE_MS } from '../helpers/browser.mjs';

test('a short requested wait is raised to the floor', () => {
  assert.equal(effectiveWaitMs(3000), WAIT_FLOOR_MS, '3000ms — w-history\'s own timeout — must be floored');
  assert.equal(effectiveWaitMs(5000), WAIT_FLOOR_MS, 'the helper default must be floored too');
  assert.equal(effectiveWaitMs(0), WAIT_FLOOR_MS);
});

test('a generous requested wait is left alone', () => {
  assert.equal(effectiveWaitMs(WAIT_FLOOR_MS + 5000), WAIT_FLOOR_MS + 5000);
  assert.equal(effectiveWaitMs(60000), 60000, 'a test that deliberately waits a long time keeps its own value');
});

test('the floor is generous enough to cover a loaded box', () => {
  assert.ok(WAIT_FLOOR_MS >= 15000, `the floor must leave real headroom, got ${WAIT_FLOOR_MS}`);
});

test('a missing or unparseable request falls back to the floor rather than 0', () => {
  assert.equal(effectiveWaitMs(undefined), WAIT_FLOOR_MS);
  assert.equal(effectiveWaitMs(Number.NaN), WAIT_FLOOR_MS);
});

// The boot deadline is the flake that bit most often, and it is a different
// budget from waitFor's: it covers Chromium starting up, not the app reaching
// a state. At load average 9.6 a boot that normally takes under a second
// overran the old fixed 30s.
test('the browser boot deadline is at least the old 30s and scales with the floor', () => {
  assert.ok(BOOT_DEADLINE_MS >= 30000, `boot must never be tighter than it was, got ${BOOT_DEADLINE_MS}`);
  assert.ok(BOOT_DEADLINE_MS >= WAIT_FLOOR_MS, 'booting cannot be given less budget than waiting for a condition');
});
