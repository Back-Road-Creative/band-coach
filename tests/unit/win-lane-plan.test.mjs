// The Windows lane's pure decisions, tested on Linux with no browser: how a
// run's results become an exit code (planLane), when the lane refuses to start
// (preflight), how its command line is read (parseArgs) and the path rules that
// keep it from writing anywhere but a run directory it made (win-paths.mjs).
// The lane itself is outside `npm test` (docs/windows-lane.md); only these
// decisions are in it. Modules are imported as namespaces so a missing export
// fails only its own test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lane from '../acceptance/win/run.mjs';
import * as paths from '../acceptance/win/win-paths.mjs';

const REG = [{ id: 'W1', file: 'w1-clean-open.win.mjs' }, { id: 'W2', file: 'w2.win.mjs' }];
const pass = (id) => ({ id, status: 'PASS', text: 'ok' });
const plan = (over) => lane.planLane({ found: true, results: [pass('W1'), pass('W2')], registry: REG, only: undefined, ...over });

test('U1 planLane: every registered scenario passed is exit 0', () => {
  assert.equal(plan(), 0);
});

test('U1 planLane: scenarios not found is exit 2', () => {
  assert.equal(plan({ found: false }), 2);
  assert.equal(plan({ found: false, results: [] }), 2);
});

test('U1 planLane: no results returns 1, never 0', () => {
  assert.equal(plan({ results: [] }), 1);
  assert.equal(plan({ results: [], registry: [] }), 1);
});

test('U1 planLane: one FAIL, OBSERVED or BLOCKED returns 1', () => {
  for (const status of ['FAIL', 'OBSERVED', 'BLOCKED']) {
    assert.equal(plan({ results: [pass('W1'), { id: 'W2', status, text: 'x' }] }), 1, status);
  }
});

test('U1 planLane: a registered scenario with no result returns 1', () => {
  assert.equal(plan({ results: [pass('W1')] }), 1);
});

test('U1 planLane: a partial --only run returns 1 even when what ran passed', () => {
  assert.equal(plan({ only: 'W1', results: [pass('W1')] }), 1);
  assert.equal(plan({ only: 'W1', results: [pass('W1')], registry: [REG[0]] }), 1);
});

const GOOD = {
  nodeVersion: '24.19.0',
  hasWebSocket: true,
  chrome: undefined,
  chromeExists: false,
  html: 'C:\\run\\band-coach.html',
  htmlExists: true,
  sha256: 'a'.repeat(64),
  actualSha: 'a'.repeat(64),
};
const pre = (over) => lane.preflight({ ...GOOD, ...over });

test('U6 preflight: everything in order returns null', () => {
  assert.equal(pre(), null);
  assert.equal(pre({ nodeVersion: 'v22.0.0' }), null);
  assert.equal(pre({ chrome: 'C:\\chrome.exe', chromeExists: true }), null);
});

test('U6 preflight: node older than 22 returns a reason naming the version', () => {
  assert.match(pre({ nodeVersion: '20.11.1' }), /20\.11\.1/);
  assert.match(pre({ nodeVersion: 'v18.0.0' }), /22/);
});

test('U6 preflight: no global WebSocket returns a reason', () => {
  assert.match(pre({ hasWebSocket: false }), /WebSocket/);
});

test('U6 preflight: --chrome given and missing returns "chrome not found"', () => {
  assert.match(pre({ chrome: 'C:\\nope\\chrome.exe', chromeExists: false }), /chrome not found: C:\\nope\\chrome\.exe/);
});

test('U6 preflight: a missing html returns a reason', () => {
  assert.match(pre({ htmlExists: false, actualSha: undefined }), /html not found: C:\\run\\band-coach\.html/);
});

test('U6 preflight: a sha mismatch returns a reason naming both shas', () => {
  const r = pre({ actualSha: 'b'.repeat(64) });
  assert.match(r, new RegExp('a'.repeat(64)));
  assert.match(r, new RegExp('b'.repeat(64)));
});

test('U6 preflight: no expected sha returns a reason', () => {
  assert.match(pre({ sha256: undefined }), /sha256/);
});

test('parseArgs: the flags the lane takes, and the defaults', () => {
  const a = lane.parseArgs(['--win-root', '/mnt/c/x/lane', '--only', 'W1', '--visible', '--sha256', 'ab', '--expect-version', '1.9.0', '--chrome', 'C:\\c.exe']);
  assert.equal(a.winRoot, '/mnt/c/x/lane');
  assert.equal(a.only, 'W1');
  assert.equal(a.visible, true);
  assert.equal(a.sha256, 'ab');
  assert.equal(a.expectVersion, '1.9.0');
  assert.equal(a.chrome, 'C:\\c.exe');
  assert.equal(a.node, '/mnt/c/Program Files/nodejs/node.exe');
  const d = lane.parseArgs(['--win-root', '/mnt/c/x/lane']);
  assert.equal(d.visible, false);
  assert.equal(d.only, undefined);
  assert.equal(d.html, undefined);
});

test('parseArgs: an unknown flag or a flag without its value throws', () => {
  assert.throws(() => lane.parseArgs(['--nope']), /--nope/);
  assert.throws(() => lane.parseArgs(['--win-root']), /--win-root/);
});

test('U5 winPathOf maps /mnt/<letter>/ paths and refuses everything else', () => {
  assert.equal(paths.winPathOf('/mnt/c/a/b'), 'C:\\a\\b');
  assert.equal(paths.winPathOf('/mnt/d/x'), 'D:\\x');
  assert.equal(paths.winPathOf('/mnt/c/Users/me/AppData/Local/Temp/band-coach-win-lane/run-1'), 'C:\\Users\\me\\AppData\\Local\\Temp\\band-coach-win-lane\\run-1');
  for (const bad of ['/home/dev/x', '/mnt/cc/x', '/mnt/1/x', 'C:\\x', 'relative/path', '/mnt/c/a/../b', '', undefined]) {
    assert.throws(() => paths.winPathOf(bad), /\/mnt\/<drive letter>\//, String(bad));
  }
});

test('U5 checkWinRoot: refuses a path containing q9probe, accepts a path under /mnt/<letter>/', () => {
  assert.equal(paths.checkWinRoot('/mnt/c/Users/me/AppData/Local/Temp/band-coach-win-lane'), null);
  assert.match(paths.checkWinRoot('/mnt/c/Users/me/AppData/Local/Temp/q9probe'), /q9probe/);
  assert.match(paths.checkWinRoot('/mnt/c/Users/me/AppData/Local/Temp/Q9Probe/x'), /q9probe/i);
  assert.match(paths.checkWinRoot('/home/dev/x'), /\/mnt\//);
  assert.match(paths.checkWinRoot('/mnt/c'), /\/mnt\//);
  assert.match(paths.checkWinRoot(undefined), /--win-root/);
});

const ROOT = '/mnt/c/Users/me/AppData/Local/Temp/band-coach-win-lane';
function tryClean(dir) {
  const calls = [];
  let threw = null;
  try {
    paths.cleanupRun(dir, ROOT, { rm: (...a) => calls.push(a) });
  } catch (e) {
    threw = e;
  }
  return { calls, threw };
}

test('U5 cleanupRun: refuses the root itself and never calls rm', () => {
  const r = tryClean(ROOT);
  assert.ok(r.threw, 'threw');
  assert.deepEqual(r.calls, []);
  assert.ok(tryClean(ROOT + '/').threw, 'root with a trailing slash');
});

test('U5 cleanupRun: refuses a non-run-* child, a deeper dir, a dir outside the root, and a dot-dot escape', () => {
  for (const bad of [ROOT + '/probe', ROOT + '/run-', ROOT + '/run-1/inner', '/mnt/c/Users/me/AppData/Local/Temp/q9probe', '/mnt/d', ROOT + '/run-1/../other', ROOT + '/../run-1', '/mnt/c/Users/me/AppData/Local/Temp/band-coach-win-lane-evil/run-1']) {
    const r = tryClean(bad);
    assert.ok(r.threw, `refused ${bad}`);
    assert.deepEqual(r.calls, [], `no rm for ${bad}`);
  }
});

test('U5 cleanupRun: calls rm for a run-* child of the root, and only that', () => {
  const r = tryClean(ROOT + '/run-aB3xYz');
  assert.equal(r.threw, null);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0][0], ROOT + '/run-aB3xYz');
  assert.equal(r.calls[0][1].recursive, true);
});

test('U5 laneEnv points TEMP and TMP inside the run dir', () => {
  assert.deepEqual(paths.laneEnv('C:\\Users\\me\\Temp\\band-coach-win-lane\\run-1'), {
    TEMP: 'C:\\Users\\me\\Temp\\band-coach-win-lane\\run-1\\tmp',
    TMP: 'C:\\Users\\me\\Temp\\band-coach-win-lane\\run-1\\tmp',
  });
  assert.throws(() => paths.laneEnv('/home/dev/run-1'), /Windows/);
});
