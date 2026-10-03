// The acceptance driver has to run under Windows node.exe, driving Windows
// Chrome: that is where a person hand-tests the downloaded band-coach.html.
// These tests pin the Windows-only branches of tests/helpers/browser.mjs
// (browser lookup, PATH splitting, launch flags, the DevToolsActivePort
// handshake, process-tree kill, profile removal, file URLs) AND that the
// Linux behaviour is exactly what it was. No real browser and no Windows
// filesystem is touched: every Windows case injects `platform: 'win32'`, an
// env and an `exists`. The module is imported as a namespace so a missing
// export fails only its own test, with a TypeError, not the whole file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as driver from '../helpers/browser.mjs';

const PF = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PF86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const LOCAL = 'C:\\Users\\jp\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const ON_PATH = 'D:\\tools\\chrome.exe';
const WIN_ENV = {
  CHROME_BIN: 'E:\\custom\\chrome.exe',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\jp\\AppData\\Local',
  PATH: 'C:\\Windows;D:\\tools',
};
const existsIn = (set) => (p) => set.has(p);

// The default launch list at 708aef7, copied literally so a change to the
// shared list cannot slip through unseen.
const LINUX_DEFAULT = (dir) => [
  '--headless',
  '--remote-debugging-port=0',
  `--user-data-dir=${dir}`,
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  'about:blank',
];

test('pathEntries splits on the platform separator', () => {
  const win = driver.pathEntries({ PATH: 'C:\\Windows;C:\\Program Files\\nodejs' }, 'win32');
  assert.deepEqual(win, ['C:\\Windows', 'C:\\Program Files\\nodejs']);
  assert.deepEqual(driver.pathEntries({ Path: 'C:\\Windows;D:\\x' }, 'win32'), ['C:\\Windows', 'D:\\x']);
  const saved = process.env.PATH;
  try {
    // On linux the default reads the real process.env.PATH (as it always did).
    process.env.PATH = '/a:/b';
    assert.deepEqual(driver.pathEntries({}, 'linux'), ['/a', '/b']);
    delete process.env.PATH;
    assert.deepEqual(driver.pathEntries({}, 'linux'), ['']);
    process.env.PATH = '/x:/y';
    // ...not the injected env.
    assert.deepEqual(driver.pathEntries({ PATH: '/ignored' }, 'linux'), ['/x', '/y']);
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
});

test('findAcceptanceBrowser on win32 looks in the Windows places, in order', () => {
  const find = (have, env = WIN_ENV, extra = {}) =>
    driver.findAcceptanceBrowser({ env, platform: 'win32', exists: existsIn(new Set(have)), ...extra });
  const all = [WIN_ENV.CHROME_BIN, PF, PF86, LOCAL, ON_PATH];
  assert.equal(find(all), WIN_ENV.CHROME_BIN, 'CHROME_BIN first');
  assert.equal(find(all.slice(1)), PF, 'then Program Files');
  assert.equal(find(all.slice(2)), PF86, 'then Program Files (x86)');
  assert.equal(find(all.slice(3)), LOCAL, 'then the per-user install');
  assert.equal(find(all.slice(4)), ON_PATH, 'then PATH');

  const shell = 'E:\\pw\\chrome-headless-shell.exe';
  assert.throws(() => find([shell, PF], { ...WIN_ENV, CHROME_BIN: shell }), /headless shell/);

  assert.throws(
    () => find([]),
    (e) => /CHROME_BIN/.test(e.message) && e.message.includes('C:\\Program Files\\Google\\Chrome\\Application'),
  );

  // A Playwright cache is a linux idea: never returned on win32.
  const root = mkdtempSync(join(tmpdir(), 'band-coach-win32-pw-'));
  try {
    mkdirSync(join(root, 'chromium-1200', 'chrome-linux64'), { recursive: true });
    writeFileSync(join(root, 'chromium-1200', 'chrome-linux64', 'chrome'), '');
    assert.throws(() => driver.findAcceptanceBrowser({ env: { PATH: '' }, platform: 'win32', playwrightRoot: root, exists: () => false }), /CHROME_BIN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('browserArgs: the linux lists are unchanged', () => {
  assert.deepEqual(driver.browserArgs('/p'), LINUX_DEFAULT('/p'));
  assert.deepEqual(driver.browserArgs('/p', ['--x'], { acceptance: true }), [
    '--headless',
    '--remote-debugging-port=0',
    '--user-data-dir=/p',
    '--no-first-run',
    '--use-fake-device-for-media-stream',
    '--x',
    'about:blank',
  ]);
});

test('browserArgs: win32 and headed switch the flags', () => {
  const win = driver.browserArgs('C:\\p', [], { platform: 'win32' });
  assert.ok(win.includes('--headless=new'));
  assert.ok(win.includes('--disable-extensions'));
  assert.ok(win.includes('--no-default-browser-check'));
  assert.ok(!win.includes('--headless'), 'bare --headless on win32');

  const headed = driver.browserArgs('C:\\p', [], { platform: 'win32', headed: true, windowPosition: '-32000,-32000' });
  assert.ok(!headed.some((a) => a.startsWith('--headless')));
  assert.ok(headed.includes('--window-position=-32000,-32000'));

  const notHeaded = driver.browserArgs('C:\\p', [], { platform: 'win32', windowPosition: '1,2' });
  assert.ok(!notHeaded.some((a) => a.startsWith('--window-position')));

  const linuxHeaded = driver.browserArgs('/p', [], { platform: 'linux', headed: true });
  assert.ok(!linuxHeaded.some((a) => a.startsWith('--headless')));
  assert.ok(!linuxHeaded.includes('--disable-extensions'));
});

test('readDevtoolsActivePort needs both complete, numeric lines', () => {
  const real = '55628\n/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4';
  assert.deepEqual(driver.readDevtoolsActivePort(real), { port: 55628, path: '/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4' });
  assert.deepEqual(driver.readDevtoolsActivePort(real.replace('\n', '\r\n')), { port: 55628, path: '/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4' });
  for (const half of ['', '55628', '55628\n', 'abc\n/devtools/browser/x']) {
    assert.equal(driver.readDevtoolsActivePort(half), null, JSON.stringify(half));
  }
  // Chrome writes no trailing newline, so a read can catch the second line cut off anywhere.
  // Every proper prefix of the real GUID path, and a path of the wrong shape, stays null.
  const path = '/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4';
  for (let n = 1; n < path.length; n++) {
    assert.equal(driver.readDevtoolsActivePort('55628\n' + path.slice(0, n)), null, `second line cut at ${n}: ${path.slice(0, n)}`);
  }
  for (const odd of ['/devtools/page/0b7b1575-5413-4b1a-8f43-b1141519f2b4', path + '0', path + '/x']) {
    assert.equal(driver.readDevtoolsActivePort('55628\n' + odd), null, odd);
  }
});

// A stand-in Chrome: a shell script that finds its --user-data-dir and then runs `body` with it as $D.
function fakeWinChrome(dir, body) {
  const bin = join(dir, 'fake-chrome.sh');
  writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do case "$a" in --user-data-dir=*) D="\${a#--user-data-dir=}";; esac; done\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

// Each case gets its own temp dir and kills its own child (the win32 launch
// shape is not a process group on Linux, so spawnBrowser's group kill misses it).
async function withFakeChrome(t, body, { launchTimeoutMs, pollMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-win32-spawn-'));
  const profile = join(dir, 'profile');
  mkdirSync(profile);
  let child;
  t.after(() => {
    if (child) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  const bin = fakeWinChrome(dir, body);
  const started = Date.now();
  const outcome = await driver.spawnBrowser(bin, profile, [], { platform: 'win32', launchTimeoutMs, pollMs }).then(
    (spawned) => ({ spawned }),
    (error) => ({ error }),
  );
  child = (outcome.spawned || outcome.error || {}).child;
  return { ...outcome, elapsed: Date.now() - started };
}

test('spawnBrowser on win32 resolves from DevToolsActivePort once both lines are there', { timeout: 10000 }, async (t) => {
  const r = await withFakeChrome(t, 'printf "41234\\n/devtools/browser/0b7b1575-5413" > "$D/DevToolsActivePort"\nsleep 0.3\nprintf -- "-4b1a-8f43-b1141519f2b4" >> "$D/DevToolsActivePort"\nexec sleep 30', { launchTimeoutMs: 2000 });
  assert.ok(r.spawned, r.error && r.error.message);
  assert.equal(r.spawned.browserWsUrl, 'ws://127.0.0.1:41234/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4');
  assert.ok(r.elapsed >= 250, `resolved after ${r.elapsed}ms, before the second line was written`);
  assert.ok(r.spawned.args.includes('--headless=new'));
});

test('spawnBrowser on win32 reports a browser that exits first (no stderr pipe to release)', { timeout: 10000 }, async (t) => {
  const r = await withFakeChrome(t, 'exit 3', { launchTimeoutMs: 2000 });
  assert.ok(r.error, 'resolved for a browser that exited');
  assert.match(r.error.message, /exited \(code 3\) before DevTools was ready/);
  assert.match(r.error.message, /had not written a complete DevToolsActivePort file/);
});

// pollMs is set far above the fake's lifetime (a shell that writes one file and exits), so the exit
// handler always runs before the first poll and the case cannot flake on which of the two fires first.
test('spawnBrowser on win32 never resolves a browser that wrote its port file and exited at once', { timeout: 10000 }, async (t) => {
  const r = await withFakeChrome(t, 'printf "41234\\n/devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4" > "$D/DevToolsActivePort"\nexit 5', { launchTimeoutMs: 3000, pollMs: 1000 });
  assert.ok(r.error, 'resolved for a browser that had already exited');
  assert.match(r.error.message, /exited \(code 5\) before DevTools was ready/);
  assert.match(r.error.message, /had written a complete DevToolsActivePort file \(port 41234\) before it exited/);
});

test('spawnBrowser on win32 times out with LAUNCH_TIMEOUT_CODE when the port file never appears', { timeout: 10000 }, async (t) => {
  const r = await withFakeChrome(t, 'exec sleep 30', { launchTimeoutMs: 300 });
  assert.ok(r.error, 'resolved for a browser that never wrote the port file');
  assert.equal(r.error.code, driver.LAUNCH_TIMEOUT_CODE);
  assert.match(r.error.message, /DevToolsActivePort file in .*profile/);
  assert.doesNotMatch(r.error.message, /listening line/);
});

test('spawnBrowser on linux still times out naming the stderr listening line', { timeout: 10000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-linux-timeout-'));
  const profile = join(dir, 'profile');
  mkdirSync(profile);
  const bin = fakeWinChrome(dir, 'exec sleep 30');
  let child;
  t.after(() => {
    if (child) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  const err = await driver.spawnBrowser(bin, profile, [], { platform: 'linux', launchTimeoutMs: 300 }).then(() => null, (e) => e);
  assert.ok(err, 'resolved for a browser that never printed the listening line');
  child = err.child;
  assert.equal(err.code, driver.LAUNCH_TIMEOUT_CODE);
  assert.equal(err.message, 'timed out waiting for DevTools listening line');
});

test('killTree kills the whole tree the platform way and never throws', () => {
  const calls = [];
  const kill = (...a) => calls.push(['kill', ...a]);
  const run = (...a) => calls.push(['run', ...a]);
  driver.killTree(4242, { platform: 'win32', kill, run });
  assert.deepEqual(calls, [['run', 'taskkill.exe', ['/PID', '4242', '/T', '/F'], { stdio: 'ignore' }]], 'run called once with taskkill.exe');
  calls.length = 0;
  driver.killTree(4242, { platform: 'linux', kill, run });
  assert.deepEqual(calls, [['kill', -4242, 'SIGKILL']]);
  const boom = () => {
    throw new Error('gone');
  };
  assert.doesNotThrow(() => driver.killTree(1, { platform: 'win32', kill, run: boom }));
  assert.doesNotThrow(() => driver.killTree(1, { platform: 'linux', kill: boom, run }));
});

test('spawnOptions and profileRmOptions: linux as before, win32 retries and does not detach', () => {
  assert.deepEqual(driver.spawnOptions('linux'), { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const w = driver.spawnOptions('win32');
  assert.equal(w.detached, false);
  assert.equal(w.stdio, 'ignore');
  assert.deepEqual(driver.profileRmOptions('linux'), { recursive: true, force: true });
  const rm = driver.profileRmOptions('win32');
  assert.equal(rm.recursive, true);
  assert.equal(rm.force, true);
  assert.ok(rm.maxRetries > 0 && rm.retryDelay > 0);
});

test('htmlTarget makes a Windows path a file URL and leaves linux paths alone', () => {
  assert.equal(driver.htmlTarget('D:\\band-coach.html', { windows: true }).url, 'file:///D:/band-coach.html');
  assert.deepEqual(driver.htmlTarget('D:\\band-coach.html', { windows: true }), { url: 'file:///D:/band-coach.html', file: 'D:\\band-coach.html' });
  assert.deepEqual(driver.htmlTarget('file:///D:/band-coach.html', { windows: true }), { url: 'file:///D:/band-coach.html', file: 'D:\\band-coach.html' });
  for (const p of ['/tmp/x/band-coach.html', '/tmp/a b#c.html']) {
    assert.deepEqual(driver.htmlTarget(p, { windows: false }), { url: 'file://' + p, file: p });
  }
});
