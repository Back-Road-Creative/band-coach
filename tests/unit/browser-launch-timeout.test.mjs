// Regression test for the CI hang on main run 35817336881: Chromium missed
// the DevTools startup window, spawnBrowser() rejected with "timed out
// waiting for DevTools listening line" -- and left the detached browser (and
// its whole process group) running, with its stderr still piped into the test
// process. That open pipe kept the test file alive, so the job sat idle until
// the 10-minute timeout cancelled it. A missed startup window must fail fast
// AND leave nothing behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnBrowser } from '../helpers/browser.mjs';

const execFileAsync = promisify(execFile);

async function pidsInGroup(pgid) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-g', String(pgid)]);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    if (err.code === 1) return [];
    throw err;
  }
}

async function waitForGroupEmpty(pgid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = await pidsInGroup(pgid);
  while (last.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await pidsInGroup(pgid);
  }
  return last;
}

// A stand-in "browser" that starts a helper process (like Chromium's
// renderer/GPU/zygote) and then never prints the DevTools line.
function fakeSilentBrowser(dir) {
  const bin = join(dir, 'silent-browser.sh');
  writeFileSync(bin, '#!/bin/sh\nsleep 300 &\necho "starting..." >&2\nexec sleep 300\n');
  chmodSync(bin, 0o755);
  return bin;
}

test('a browser that misses the DevTools window is killed with its whole group', { timeout: 20000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-launch-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = fakeSilentBrowser(dir);

  const err = await spawnBrowser(bin, join(dir, 'profile'), [], { launchTimeoutMs: 300 }).then(
    () => assert.fail('spawnBrowser resolved for a browser that never printed the DevTools line'),
    (e) => e,
  );
  assert.match(err.message, /timed out waiting for DevTools listening line/);
  assert.ok(err.child && err.child.pid > 0, 'the rejection must carry the child it gave up on');

  const left = await waitForGroupEmpty(err.child.pid);
  assert.deepEqual(left, [], `processes left in the abandoned browser's group: ${left.join(', ')}`);
  assert.equal(err.child.stderr.destroyed, true, "the browser's stderr pipe must be released so the test process can exit");
});
