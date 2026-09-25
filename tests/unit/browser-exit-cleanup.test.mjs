// Regression test for the OTHER orphaned chrome-headless-shell leak: a test
// process that ends without reaching page.close(). Every browser test does
// `t.after(() => page.close())`, which covers an assertion failing, but not a
// test PROCESS dying first — an uncaught error thrown outside a test body,
// node:test aborting the file on a deadline (SIGTERM), Ctrl-C in a shell
// (SIGINT), or a hung-up terminal (SIGHUP). The browser is launched in its own
// detached process group precisely so close() can kill all of it, and that
// same detachment lets it outlive the process that launched it: 21 orphan
// groups, the oldest 43 hours old, were counted on the box on 2026-09-24.
// launchPage() must therefore register every browser it launches and kill
// the group (and remove its profile dir) when the process exits or is
// signalled, whether or not anyone ever called close().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTML_PATH } from '../helpers/html-path.mjs';

const execFileAsync = promisify(execFile);
const HELPER = fileURLToPath(new URL('../helpers/browser.mjs', import.meta.url));

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

// A stand-in for a test file: launches one browser, reports its group id and
// profile dir on stdout, then ends the way the named scenario says — never
// calling close(). Written to disk so it runs as a real separate process
// with its own module registry and its own signal handlers.
function writeChildScript(dir) {
  const path = join(dir, 'leaky-test-process.mjs');
  writeFileSync(
    path,
    [
      `import { launchPage } from ${JSON.stringify(HELPER)};`,
      `const page = await launchPage(${JSON.stringify(HTML_PATH)});`,
      `process.stdout.write(JSON.stringify({ pid: page.pid, profileDir: page.profileDir }) + '\\n');`,
      `if (process.argv[2] === 'throw') throw new Error('the test process failed before any close() ran');`,
      `setInterval(() => {}, 1000); // 'signal': stay alive until the parent signals us`,
    ].join('\n')
  );
  return path;
}

// Runs the child in `scenario`, resolves once it has exited, with the
// browser group id it reported and how the child ended.
function runLeakyChild(script, scenario, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, scenario], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let launched = null;
    child.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (line && !launched) {
        launched = JSON.parse(line);
        if (signal) child.kill(signal);
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code, sig) => {
      if (!launched) return reject(new Error(`child never reported a browser (exit ${code}/${sig}). stderr:\n${err}`));
      resolve({ ...launched, code, sig, stderr: err });
    });
    // The child is expected to be gone well inside this; a hang here is a
    // failure of the child's own boot deadline, not of this test.
    setTimeout(() => { child.kill('SIGKILL'); }, 60000).unref();
  });
}

async function expectNoSurvivors(t, run) {
  // Whatever the helper under test did, this test must not itself leave the
  // group behind when it fails.
  t.after(() => { try { process.kill(-run.pid, 'SIGKILL'); } catch (e) { /* already gone */ } });
  t.after(() => { rmSync(run.profileDir, { recursive: true, force: true }); });
  assert.ok(run.pid > 0, 'the child must have launched a browser');
  const remaining = await waitForGroupEmpty(run.pid);
  assert.deepEqual(remaining, [], `browser group ${run.pid} survived its test process: ${remaining.join(', ')}`);
  assert.equal(existsSync(run.profileDir), false, `profile dir ${run.profileDir} survived its test process`);
}

const dir = mkdtempSync(join(tmpdir(), 'band-coach-exit-cleanup-'));
const script = writeChildScript(dir);
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a test process that throws before close() takes its browser down with it', { timeout: 90000 }, async (t) => {
  const run = await runLeakyChild(script, 'throw');
  assert.equal(run.code, 1, `the child should have died of its own uncaught error, got exit ${run.code}/${run.sig}`);
  await expectNoSurvivors(t, run);
});

test('a test process killed with SIGTERM takes its browser down with it', { timeout: 90000 }, async (t) => {
  const run = await runLeakyChild(script, 'signal', { signal: 'SIGTERM' });
  assert.equal(run.sig, 'SIGTERM', `the child should still die of the SIGTERM it was sent, got exit ${run.code}/${run.sig}`);
  await expectNoSurvivors(t, run);
});
