// Regression test for the orphaned chrome-headless-shell process leak:
// tests/helpers/browser.mjs used to spawn Chromium as a plain (non-detached)
// child and kill only that one process on close(). Chromium's own renderer,
// GPU and zygote processes are separate processes in the same process group
// and survived every close() call, piling up on the box (101 orphans
// observed, some 2.5 days old). launchPage() must spawn its own process
// group and close() must kill the WHOLE group, so nothing descended from the
// launched browser survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const execFileAsync = promisify(execFile);

// Lists every pid currently in process group `pgid`. pgrep exits 1 (not an
// error here) when the group is empty, which is exactly the success case
// after close() — so a non-zero/non-one exit is the only thing worth
// throwing on. Run async (not execFileSync) so it never blocks the runner's
// event loop out from under the browser's own WebSocket traffic.
async function pidsInGroup(pgid) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-g', String(pgid)]);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    if (err.code === 1) return [];
    throw err;
  }
}

// Polls briefly instead of sleeping-and-hoping: SIGKILL delivery and process
// reaping are not synchronous with the syscall returning.
async function waitForGroupEmpty(pgid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = await pidsInGroup(pgid);
  while (last.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await pidsInGroup(pgid);
  }
  return last;
}

test('close() leaves no descendant process of the launched browser running', { timeout: 30000 }, async (t) => {
  const page = await launchPage(HTML_PATH);
  // A single close(), guarded so it never runs twice: t.after() is the
  // failsafe for an assertion throwing before the explicit close() below
  // runs, not a second call on the happy path — double-closing the same
  // DevTools target/socket raced node:test's own teardown in practice.
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    return page.close();
  };
  t.after(closeOnce);

  assert.ok(page.pid > 0, 'launchPage() must expose the spawned process/group id');
  const before = await pidsInGroup(page.pid);
  assert.ok(before.length > 0, 'the browser process group should contain at least the browser itself while running');

  await closeOnce();

  const remaining = await waitForGroupEmpty(page.pid);
  assert.deepEqual(remaining, [], `expected no processes left in group ${page.pid}, found: ${remaining.join(', ')}`);
});
