// Drives a real headless Chromium over the Chrome DevTools Protocol using only
// Node 22 built-ins (global WebSocket + fetch, node:child_process, node:fs,
// node:os). No npm dependency — see site-headlessmode/scripts/preview-overflow.mjs
// for the precedent this borrows its connection pattern from.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir, availableParallelism, loadavg } from 'node:os';
import { join, dirname, basename, win32 as winPath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// How many test FILES node:test may run at once — each file launches its own
// Chromium, so this is really "how many browsers may boot at the same time".
// With no cap that is NODE_DEFAULT_CONCURRENCY below, which is fine on a quiet
// box but is exactly what turned a sibling suite's load into a wave of missed
// 60s boot deadlines (three different characterization files, 2026-09-20 — see
// tests/unit/test-concurrency.test.mjs). A box at or under its own core count
// is quiet: keep node's own default, so neither a dev machine nor the small CI
// runner changes behaviour at all. Past that, concurrency backs off
// proportionally to how far over the box is loaded, never below 1.
// BAND_COACH_TEST_CONCURRENCY overrides the computation outright for a box
// that needs telling to go narrower than the formula would pick.
//
// node:test's undocumented-in-`node --help` default is availableParallelism()
// MINUS ONE — measured on node v22.22.2, 12 cores: 11 files in flight with no
// flag, 12 with --test-concurrency=12. Returning `cores` here would quietly
// RAISE concurrency on every quiet box, which is the opposite of the point and
// cost this change a CI run: on a 4-core runner it meant 4 browsers where node
// would have used 3, and the extra contention showed up as a tuner test
// reading 50 cents of spread on a steady 440Hz tone.
export const NODE_DEFAULT_CONCURRENCY = cores => Math.max(1, cores - 1);

export function computeTestConcurrency({ cores = availableParallelism(), load1 = loadavg()[0] } = {}) {
  const override = Number(process.env.BAND_COACH_TEST_CONCURRENCY);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  const base = NODE_DEFAULT_CONCURRENCY(cores);
  if (!(load1 > cores)) return base;
  return Math.max(1, Math.round((base * cores) / load1));
}

// Lets `node tests/helpers/browser.mjs` print the computed concurrency on its
// own stdout, so package.json's test script can feed it to
// `--test-concurrency` via command substitution without a second file.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(computeTestConcurrency());
}

function findPlaywrightHeadlessShell() {
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-'));
  // Highest revision number last so we prefer the newest install.
  dirs.sort();
  for (const d of dirs.reverse()) {
    const bin = join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(bin)) return bin;
  }
  return null;
}

// WINDOWS LANE. A person hand-tests the downloaded band-coach.html on Windows,
// and WSL's NAT networking means a Linux-side driver cannot reach a Windows
// Chrome's DevTools port, so the same driver also runs under Windows node.exe
// (launched from WSL) and drives Windows Chrome over Windows loopback. Everything
// platform-specific is here and takes `platform` as a parameter so a unit test
// can pin it on Linux (tests/unit/browser-win32.test.mjs). On linux every
// function below does exactly what it did before the lane existed. What differs
// on win32, and why:
//  - the browser is found in Program Files / LOCALAPPDATA / PATH (`;`-separated,
//    drive letters contain ':'), Chrome only, no Playwright cache;
//  - Chrome is spawned with `--headless=new`, extensions off and no default
//    browser check, stdio ignored, and its port is read from the
//    DevToolsActivePort file in the profile (a stderr line is not relied on);
//  - there are no process groups, so the tree is killed with taskkill /T /F;
//  - Chrome holds profile files briefly after it dies, so removal retries;
//  - a `D:\x.html` path becomes a proper file:///D:/x.html URL.
// The pieces a real Windows run has to confirm are listed in the Q9 unit spec.
export function pathEntries(env = process.env, platform = process.platform) {
  if (platform === 'win32') return (env.PATH || env.Path || '').split(';');
  return (process.env.PATH || '').split(':');
}

function onPath(name) {
  const dirs = pathEntries();
  for (const dir of dirs) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function findBrowserBinary() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const shell = findPlaywrightHeadlessShell();
  if (shell) return shell;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const p = onPath(name);
    if (p) return p;
  }
  return null;
}

// The browser an acceptance launch uses: a FULL Chrome or Chromium, never the
// headless shell, whose autoplay and permission behaviour is not a real
// browser's. Order: CHROME_BIN, the Playwright full build (newest first),
// google-chrome on PATH. The inputs are parameters so a unit test can hand it
// a made-up install tree.
export function findAcceptanceBrowser({
  env = process.env,
  playwrightRoot = join(homedir(), '.cache', 'ms-playwright'),
  platform = process.platform,
  pathDirs = pathEntries(env, platform),
  exists = existsSync,
} = {}) {
  const isShell = (p) => /headless[-_]shell/i.test(p);
  if (env.CHROME_BIN && exists(env.CHROME_BIN)) {
    if (isShell(env.CHROME_BIN)) {
      throw new Error(
        `CHROME_BIN points at a headless shell (${env.CHROME_BIN}). The acceptance lane needs a full Chrome or ` +
          'Chromium, whose autoplay and permission behaviour is a real browser\'s. Point CHROME_BIN at google-chrome or a full chromium build.'
      );
    }
    return env.CHROME_BIN;
  }
  if (platform === 'win32') {
    const rel = winPath.join('Google', 'Chrome', 'Application', 'chrome.exe');
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
      const p = base && winPath.join(base, rel);
      if (p && exists(p)) return p;
    }
    for (const dir of pathDirs) {
      const p = dir && winPath.join(dir, 'chrome.exe');
      if (p && exists(p)) return p;
    }
    throw new Error(
      'No Chrome found for the acceptance lane on Windows. Set CHROME_BIN to chrome.exe, or install Google Chrome ' +
        '(expected at C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe). Only Chrome is used here, not Edge.'
    );
  }
  if (existsSync(playwrightRoot)) {
    const dirs = readdirSync(playwrightRoot).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const d of dirs) {
      const bin = join(playwrightRoot, d, 'chrome-linux64', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  for (const name of ['google-chrome', 'google-chrome-stable']) {
    for (const dir of pathDirs) {
      const p = join(dir, name);
      if (dir && exists(p)) return p;
    }
  }
  throw new Error(
    'No full Chrome or Chromium found for the acceptance lane. Set CHROME_BIN to google-chrome or a full chromium build, ' +
      'or install google-chrome, or the Playwright full build (npx playwright install chromium, which makes ' +
      '~/.cache/ms-playwright/chromium-*). The headless shell (chromium_headless_shell-*) is deliberately not used: ' +
      'its autoplay and permission behaviour is not a real browser\'s.'
  );
}

// The file an acceptance test drives: the one a person downloads.
// BAND_COACH_HTML points it at another build (a negative control).
export function acceptanceHtmlPath(env = process.env) {
  return env.BAND_COACH_HTML || fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url));
}

// Talks JSON-RPC over one DevTools WebSocket connection.
export class DevtoolsClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      // A page session shares this socket and counts ids from 1 as well: a
      // session-tagged reply must not settle a browser request with the same
      // id, and a session-tagged event is the page's, not ours.
      if (msg.sessionId !== undefined) return;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('websocket error: ' + (e.message || e.type))), { once: true });
  });
}

// The code a missed DevTools startup window rejects with. Like BOOT_DEADLINE
// it is a busy-runner flake, not a defect: CI runs 35878233553, 35882082593 and
// 35884980289 each missed it at the start of the run, when many test files
// cold-start a browser at once, and each passed on a plain re-run.
// retryOnBootDeadline retries it with a fresh browser.
export const LAUNCH_TIMEOUT_CODE = 'LAUNCH_TIMEOUT';

// Every browser group this process has spawned and not yet killed, keyed by
// the group id (= the launched process's pid), with its profile dir. A browser
// lives in its own detached process group so close() can kill all of it --
// and that same detachment lets it outlive the process that launched it. The
// per-test `t.after(() => page.close())` covers a failing assertion, not the
// test PROCESS ending first: an uncaught error outside a test body, node:test
// aborting the file (SIGTERM), Ctrl-C (SIGINT) or a hung-up terminal (SIGHUP).
// 21 orphan groups, the oldest 43 hours old, were counted on the dev box on
// 2026-09-24. So the launcher itself is the fixture's finally block: on exit,
// and on those signals, every group still registered is killed and its
// profile dir removed. SIGKILL cannot be caught; a runner killed that way
// still leaks, which is why close() stays the normal path.
const liveGroups = new Map();
let exitHooksInstalled = false;

// Kills a launched browser and everything it started. linux: the pid is the
// process group id (the launch is detached), so kill the group. win32: no
// groups, so taskkill takes the tree (/T) by force (/F). Never throws: the
// process may already be gone.
export function killTree(pid, { platform = process.platform, kill = process.kill, run = spawnSync } = {}) {
  try {
    if (platform === 'win32') run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else kill(-pid, 'SIGKILL');
  } catch (e) {
    // already gone
  }
}

function killGroupNow(pgid) {
  killTree(pgid);
}

// Removing a profile directory: on Windows Chrome holds files for a moment
// after it dies, so retry. (Assumption, checked by the real Windows run.)
export function profileRmOptions(platform = process.platform) {
  return platform === 'win32' ? { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } : { recursive: true, force: true };
}

function killLiveGroups() {
  for (const [pgid, profileDir] of liveGroups) {
    killGroupNow(pgid);
    try {
      rmSync(profileDir, profileRmOptions());
    } catch (e) {
      // best-effort cleanup
    }
  }
  liveGroups.clear();
}

function trackGroup(pgid, profileDir) {
  liveGroups.set(pgid, profileDir);
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  // 'exit' runs synchronously at the very end, whatever the exit code:
  // a normal finish, process.exit(), or an uncaught error.
  process.once('exit', killLiveGroups);
  // A signal handler replaces the default action (die), so after cleaning up
  // the same signal is re-raised with the handler gone: the process still
  // dies of the signal it was sent, exactly as if nothing had been listening.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => {
      killLiveGroups();
      process.kill(process.pid, sig);
    });
  }
}

function untrackGroup(pgid) {
  liveGroups.delete(pgid);
}

// Spawns the browser and resolves once "DevTools listening on ws://..." is
// seen on stderr, extracting the port that was actually bound (we always ask
// for port 0 so parallel test files never collide). The group is registered
// for exit cleanup from the moment it exists.
// The command-line flags of a launch. The default is permissive on purpose
// (autoplay allowed, a mic prompt that answers itself) so a characterization
// test never waits on a gesture. An acceptance launch drops exactly those two
// and keeps the simulated devices: a fake mic is a device, not a permission.
// `headed` leaves the headless flag out; `windowPosition` ('x,y') places a
// headed window. On win32 the probe's flags apply: --headless=new, extensions
// off, no default-browser check.
export function browserArgs(userDataDir, extraArgs = [], { acceptance = false, headed = false, windowPosition, platform = process.platform } = {}) {
  const win = platform === 'win32';
  return [
    ...(headed ? [] : [win ? '--headless=new' : '--headless']),
    ...(headed && windowPosition ? [`--window-position=${windowPosition}`] : []),
    ...(win ? ['--disable-extensions', '--no-default-browser-check'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    ...(acceptance ? [] : ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream']),
    '--use-fake-device-for-media-stream',
    ...extraArgs,
    'about:blank',
  ];
}

// How the browser is spawned. linux: its own process group (detached) with
// stderr piped, to read the DevTools line. win32: not detached (no groups;
// taskkill /T takes the tree) and stdio ignored, as the probe did; the port
// comes from the DevToolsActivePort file instead.
export function spawnOptions(platform = process.platform) {
  return platform === 'win32' ? { stdio: 'ignore', detached: false } : { stdio: ['ignore', 'ignore', 'pipe'], detached: true };
}

// The content of Chrome's DevToolsActivePort file: the port, then the browser
// websocket path (`/devtools/browser/<guid>`, e.g. the Q9 probe's
// 55628 + /devtools/browser/0b7b1575-5413-4b1a-8f43-b1141519f2b4). Chrome
// writes no trailing newline, so a second line is trusted only when the whole
// GUID is there: a cut-off one stays null and the poll keeps waiting.
const BROWSER_PATH = /^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readDevtoolsActivePort(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length < 2 || !/^\d+$/.test(lines[0]) || !BROWSER_PATH.test(lines[1])) return null;
  return { port: Number(lines[0]), path: lines[1] };
}

// `platform` only selects the launch shape; kill and exit hooks use the real one.
// `pollMs` is how often the win32 port file is read; only a test with a fake browser changes it.
export function spawnBrowser(bin, userDataDir, extraArgs = [], { launchTimeoutMs = 15000, acceptance = false, headed = false, windowPosition, platform = process.platform, pollMs = 50 } = {}) {
  const win = platform === 'win32';
  const args = browserArgs(userDataDir, extraArgs, { acceptance, headed, windowPosition, platform });
  if (process.env.CI) args.splice(1, 0, '--no-sandbox');
  // Its own process group (detached), so cleanup can kill the renderer, GPU
  // and zygote processes too, not just the launched parent: those are
  // separate processes that a plain child.kill() never touches, and they
  // survive as orphans (101 observed piled up on the box before this fix).
  const child = spawn(bin, args, spawnOptions(platform));
  if (child.pid) trackGroup(child.pid, userDataDir);
  return new Promise((resolve, reject) => {
    let buf = '';
    // A launch that fails before resolving has handed nobody a child to kill,
    // so it must clean up here: kill the whole detached group and release the
    // stderr pipe. Either one left alive keeps the test process from exiting
    // -- main run 35817336881 hung until its 10-minute job timeout that way.
    // Settles once: after a successful launch the startup timer and the exit
    // handler must never reach back and kill the browser a caller now owns.
    let settled = false;
    let timer;
    let poll;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (child.pid) {
        killGroupNow(child.pid);
        untrackGroup(child.pid);
      }
      if (child.stderr) child.stderr.destroy();
      err.child = child;
      reject(err);
    };
    const onErr = (err) => fail(err);
    child.once('error', onErr);
    if (win) {
      const readPort = () => {
        try {
          return readDevtoolsActivePort(readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8'));
        } catch (e) {
          return null; // not written yet
        }
      };
      poll = setInterval(() => {
        if (settled) return;
        // No child-exited check here: Node sets the exit code and emits 'exit' in one step, and
        // that handler settles the launch (as a failure) before any later tick, so a browser that
        // has exited can never reach the resolve below, whatever its port file holds.
        const found = readPort();
        if (!found) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        child.off('error', onErr);
        resolve({ child, browserWsUrl: `ws://127.0.0.1:${found.port}${found.path}`, args });
      }, pollMs);
      child.once('exit', (code) => {
        if (settled) return;
        // One last read: the file may have landed between the last poll and the exit.
        const last = readPort();
        fail(new Error(`browser exited (code ${code}) before DevTools was ready. ` + (last ? `It had written a complete DevToolsActivePort file (port ${last.port}) before it exited.` : 'It had not written a complete DevToolsActivePort file.')));
      });
    } else {
      child.stderr.on('data', (chunk) => {
        buf += chunk.toString();
        const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m && !settled) {
          settled = true;
          clearTimeout(timer);
          child.off('error', onErr);
          resolve({ child, browserWsUrl: m[1], args });
        }
      });
      child.once('exit', (code) => {
        if (!buf.includes('DevTools listening')) {
          fail(new Error(`browser exited (code ${code}) before DevTools was ready. stderr:\n${buf}`));
        }
      });
    }
    timer = setTimeout(() => {
      const err = new Error(win ? `timed out waiting for the DevToolsActivePort file in ${userDataDir}` : 'timed out waiting for DevTools listening line');
      err.code = LAUNCH_TIMEOUT_CODE;
      fail(err);
    }, launchTimeoutMs).unref();
  });
}

// The URL a page is opened at and the file the identity block reads. A
// `file:` URL passes through. A Windows path becomes a real file URL
// (`D:\x.html` -> `file:///D:/x.html`). Anything else keeps the exact
// `'file://' + path` the driver always used (pathToFileURL would percent-encode
// it, which is a change on Linux).
export function htmlTarget(htmlPath, { windows = process.platform === 'win32' } = {}) {
  if (/^file:/i.test(htmlPath)) return { url: htmlPath, file: fileURLToPath(htmlPath, { windows }) };
  if (windows) return { url: pathToFileURL(htmlPath, { windows: true }).href, file: htmlPath };
  return { url: 'file://' + htmlPath, file: htmlPath };
}

/**
 * Launches a fresh headless browser with its own temp profile and opens
 * `htmlPath` via its file:// URL (proving the app also runs double-clicked,
 * not just under a dev server). Returns a page-driving handle.
 *
 * `options.fakeAudioFile`, if given, is an absolute path to a WAV file
 * played into the fake microphone device (via Chromium's
 * `--use-file-for-fake-audio-capture`) instead of silence, so a real
 * `getUserMedia()` capture in the page has an actual signal to detect.
 *
 * `options.initScript`, if given, is a JS source string installed with
 * `Page.addScriptToEvaluateOnNewDocument` so it runs before any of the
 * page's own script — e.g. to instrument a global before app code loads.
 *
 * `options.acceptance`, if true, launches the way a person's browser runs
 * (see "Acceptance mode" at the end of this file); `options.simulated` lists
 * extra simulated boundaries for the identity block. Callers that leave them
 * out get exactly the launch they always had.
 *
 * `options.headed` opens a visible window (no headless flag) and
 * `options.windowPosition` ('x,y') places it; `htmlPath` may be a Windows path
 * or a `file:` URL (see "WINDOWS LANE" above).
 *
 * Throws — never silently skips — if no browser binary can be found.
 */

// The shortest a page.waitFor() is allowed to give up in. A wait that is too
// LONG costs seconds, and only on a run that is failing anyway; a wait that is
// too SHORT marks correct code as broken at random. On 2026-09-20 three
// different characterization tests went red on three consecutive full runs on
// a box also running two other suites and a CI runner, each passing 3/3 solo
// straight after — w-history's was `waitFor timed out after 3000ms` for a
// localStorage write that is synchronous in the page. Floored here rather than
// at ~40 call sites so a new test cannot reintroduce the same flake.
// BAND_COACH_WAIT_FLOOR_MS overrides it (a smaller value makes a genuinely
// failing run give up sooner while iterating locally).
export const WAIT_FLOOR_MS = Number(process.env.BAND_COACH_WAIT_FLOOR_MS) > 0
  ? Number(process.env.BAND_COACH_WAIT_FLOOR_MS)
  : 20000;

// The timeout a waitFor() call actually gets: what it asked for, or the floor,
// whichever is longer. A missing or unparseable request is the floor, never 0.
export function effectiveWaitMs(requestedMs) {
  const n = Number(requestedMs);
  return Number.isFinite(n) && n > WAIT_FLOOR_MS ? n : WAIT_FLOOR_MS;
}

// How long launchPage() waits for the page to finish booting. This is the
// flake that bit most often — `the page never finished booting (no #cv in a
// complete file:// document within 30s)` — and it is a different budget from
// waitFor()'s: it covers Chromium starting up, not the app reaching a state,
// so it scales off the floor rather than sharing it. At load average 9.6 a
// boot that normally takes under a second overran 30s.
export const BOOT_DEADLINE_MS = Math.max(30000, WAIT_FLOOR_MS * 3);

// The one error a caller is allowed to retry. `retryFlaky` aborts on a thrown
// error by design -- a crash is not a flake -- but a boot that ran out of
// budget on a starved runner IS the flake, and a fresh browser usually clears
// it. Callers catch this by `err.code`, never by matching the message: the
// wording is diagnostic and should stay free to improve, while the code is a
// contract (see tests/unit/boot-deadline-error.test.mjs). Raising
// BOOT_DEADLINE_MS is NOT the fix -- a boot that never completes is also what
// a genuine regression looks like, so a longer wait would only hide it later.
export const BOOT_DEADLINE_CODE = 'BOOT_DEADLINE';

export function bootDeadlineError(ms) {
  const err = new Error(
    `the page never finished booting (no data-coach-ready on a complete file:// document within ${ms}ms)`,
  );
  err.code = BOOT_DEADLINE_CODE;
  return err;
}

// Retry policy for a launch that ran out of boot budget. It lives here, around
// every launch, rather than at individual call sites: the thing that overruns
// is the launch, so ANY browser test can hit it -- boot-ready did, and so did
// deaf-window, which nothing had wrapped. A per-test wrap would have to be
// remembered by every future test; this cannot be forgotten.
//
// Only BOOT_DEADLINE and LAUNCH_TIMEOUT are retried. Every other error propagates on the first
// attempt: a missing browser binary or a CDP protocol failure is not a flake,
// and retrying it would turn one clear message into three slow identical ones.
// launchPageOnce already kills the browser group and removes its user-data dir
// before it rethrows (see the try/catch around finishLaunch), so an abandoned
// attempt leaks neither a process nor a directory.
export async function retryOnBootDeadline(launch, { attempts = 3 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await launch(i);
    } catch (err) {
      if (!err || (err.code !== BOOT_DEADLINE_CODE && err.code !== LAUNCH_TIMEOUT_CODE)) throw err;
      last = err;
    }
  }
  const err = bootDeadlineError(BOOT_DEADLINE_MS);
  if (last) err.code = last.code;
  err.message = `${last ? last.message : err.message} -- and again in ${attempts} attempts, each with a fresh browser. Failing every time points at the app or the build, not at a busy runner.`;
  err.attempts = attempts;
  throw err;
}

export function launchPage(htmlPath, options = {}) {
  return retryOnBootDeadline(() => launchPageOnce(htmlPath, options));
}

async function launchPageOnce(htmlPath, options = {}) {
  const { fakeAudioFile, initScript, acceptance = false, headed = false, windowPosition } = options;
  const bin = acceptance ? findAcceptanceBrowser() : findBrowserBinary();
  if (!bin) {
    throw new Error(
      'No Chromium-family browser found. Set CHROME_BIN, or install one of: ' +
        'the Playwright headless shell (~/.cache/ms-playwright/chromium_headless_shell-*), ' +
        'google-chrome, google-chrome-stable, chromium, chromium-browser.'
    );
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'band-coach-cdp-'));
  const extraArgs = fakeAudioFile ? [`--use-file-for-fake-audio-capture=${fakeAudioFile}`] : [];
  let spawned;
  try {
    spawned = await spawnBrowser(bin, userDataDir, extraArgs, { acceptance, headed, windowPosition });
  } catch (e) {
    // spawnBrowser already killed the group; the profile dir is ours to remove.
    rmSync(userDataDir, profileRmOptions());
    throw e;
  }
  const { child, browserWsUrl, args: launchFlags } = spawned;

  // child.pid is the process GROUP id too, since spawnBrowser starts it
  // detached (group leader). Kills the whole group, not just this one
  // process — a surviving renderer/GPU/zygote process would otherwise
  // recreate userDataDir the instant rmSync below removes it.
  function killGroup() {
    killGroupNow(child.pid);
    untrackGroup(child.pid);
  }

  // Anything below this point can throw before launchPage returns a handle
  // whose close() the caller could invoke — a WebSocket that never opens, a
  // CDP command that rejects, a page that never boots. Without this, that
  // exception leaves the just-spawned browser (and its whole group) running
  // forever with nothing left holding a reference to kill it.
  try {
    return await finishLaunch();
  } catch (e) {
    killGroup();
    try {
      rmSync(userDataDir, profileRmOptions());
    } catch (e2) {
      // best-effort cleanup
    }
    throw e;
  }

  async function finishLaunch() {
  const browserWs = new WebSocket(browserWsUrl);
  await waitForOpen(browserWs);
  const browser = new DevtoolsClient(browserWs);

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  // Flattened protocol: page-level commands carry sessionId, and page-level
  // events arrive as Target.receivedMessageFromTarget-free direct messages
  // tagged with the same sessionId field on the outer envelope.
  const page = {
    nextId: 0,
    pending: new Map(),
    listeners: new Set(),
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++page.nextId;
      page.pending.set(id, { resolve, reject });
      browserWs.send(JSON.stringify({ id, method, params, sessionId }));
    });
  browserWs.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.sessionId !== sessionId) return;
    if (msg.id !== undefined && page.pending.has(msg.id)) {
      const { resolve, reject } = page.pending.get(msg.id);
      page.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of page.listeners) fn(msg);
    }
  });

  const consoleErrors = [];
  const exceptions = [];
  const requests = [];
  // Only filled by an acceptance launch.
  const consoleWarnings = [];
  const logEntries = [];
  const requestDetails = [];
  const audioContexts = new Map();

  page.listeners.add((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.consoleAPICalled' && acceptance && msg.params.type === 'warning') {
      consoleWarnings.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
    } else if (msg.method === 'Network.requestWillBeSent') {
      requests.push(msg.params.request.url);
      if (acceptance) requestDetails.push({ url: msg.params.request.url, type: msg.params.type, initiator: msg.params.initiator });
    } else if (acceptance && msg.method === 'Log.entryAdded') {
      const { source, level, text, url, lineNumber } = msg.params.entry;
      logEntries.push({ source, level, text, url, lineNumber });
    } else if (acceptance && (msg.method === 'WebAudio.contextCreated' || msg.method === 'WebAudio.contextChanged')) {
      const c = msg.params.context;
      const known = audioContexts.get(c.contextId) || { id: c.contextId, type: c.contextType, sampleRate: c.sampleRate, history: [] };
      known.state = c.contextState;
      known.history.push(c.contextState);
      audioContexts.set(c.contextId, known);
    } else if (acceptance && msg.method === 'WebAudio.contextWillBeDestroyed') {
      const known = audioContexts.get(msg.params.contextId);
      if (known) { known.state = 'destroyed'; known.history.push('destroyed'); }
    }
  });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('DOM.enable');
  if (acceptance) {
    // The browser's own log (the AudioContext warning is a Log entry, not a
    // console call) and WebAudio, both before navigation so boot is covered.
    await send('Log.enable');
    await send('WebAudio.enable');
    // The page's own visibilitychange events, with isTrusted, from the first
    // moment of every document.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: "window.__bcVisibility = []; document.addEventListener('visibilitychange', function (e) { window.__bcVisibility.push({ state: document.visibilityState, trusted: e.isTrusted }); }, true);",
    });
  }
  if (initScript) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  }
  if (options.reducedMotion) {
    // Applied before navigation so the app's own boot-time
    // matchMedia('(prefers-reduced-motion: reduce)') read already sees it —
    // toggling it only after load races the page's first animation frames.
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  }

  // Timed, not open-ended: under heavy load (e.g. this box's own pile of
  // stray processes competing for CPU/memory) Chromium can spawn and open
  // its DevTools socket fine but never actually fire the page's load event —
  // and with no deadline here, `await nextLoad()` then blocks forever at 0%
  // CPU (observed: an npm test run hanging 27+ minutes with nothing to show
  // for it, instead of failing loudly in seconds).
  function nextLoad(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        if (msg.method === 'Page.loadEventFired') {
          page.listeners.delete(handler);
          clearTimeout(timer);
          resolve();
        }
      };
      page.listeners.add(handler);
      const timer = setTimeout(() => {
        page.listeners.delete(handler);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for Page.loadEventFired`));
      }, timeoutMs);
    });
  }

  const { url, file: htmlFile } = htmlTarget(htmlPath);

  // Poll for the page actually BEING our document AND having finished boot,
  // rather than sleeping and hoping. Three things went wrong before: under
  // load the app's boot code (loadDB, buildPicker, first draw) had not
  // finished; `Page.loadEventFired` can be the initial about:blank's rather
  // than ours; and the condition used to be `#cv` exists, which is in the
  // STATIC MARKUP and therefore true before the app script runs a line — so
  // a11y-dialog-focus died 747ms in on `window.__coach` being undefined with
  // 29s of budget unspent (2026-09-20). The app sets `data-coach-ready` as
  // the last act of boot, in the release build too, so that is what we wait
  // for. A sleep is not a readiness check, and neither is a readiness check
  // that was already true.
  async function waitForBoot() {
    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let last = null;
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', {
        expression:
          "(location.href.indexOf('file://') === 0) && document.readyState === 'complete' && document.documentElement.getAttribute('data-coach-ready') === '1'",
        returnByValue: true,
      });
      last = r && r.result && r.result.value;
      if (last === true) return;
      await new Promise((r2) => setTimeout(r2, 25));
    }
    throw bootDeadlineError(BOOT_DEADLINE_MS);
  }

  const loaded = nextLoad();
  await send('Page.navigate', { url });
  await loaded;
  await waitForBoot();

  // A release file has no debug hook (build/build.mjs strips it); with the
  // hook present this is not the file a person downloads, so refuse.
  if (acceptance) {
    const hook = await send('Runtime.evaluate', { expression: 'typeof window.__coach', returnByValue: true });
    if (hook.result.value !== 'undefined') {
      throw new Error(
        `acceptance run refused: window.__coach is ${hook.result.value} on ${htmlPath}. That is the dev build, which carries the ` +
          'debug hook; the acceptance lane drives the release file (node build/build.mjs --release -> dist/release/band-coach.html).'
      );
    }
  }

  // Reload and wait for the NEW page's load event. Polling for window.__coach
  // after evaluate('location.reload()') can see the OLD page before it
  // unloads, then read it mid-teardown (CI flake, 2026-09-19, timing.test.mjs).
  async function reload() {
    const reloaded = nextLoad();
    await send('Page.reload', {});
    await reloaded;
    await waitForBoot();
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        'evaluate failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      );
    }
    return result.result.value;
  }

  // Sets a <input type="file"> element's FileList from real bytes on disk —
  // the CDP-level equivalent of a learner picking a file, since a page
  // script cannot construct a File backed by disk content itself. `selector`
  // is a CSS selector for the input; `filePath` an absolute path. Dispatches
  // a real 'change' event afterwards so the page's own listener fires --
  // unless the page already reacted to setFileInputFiles' own change event
  // by removing the input (e.g. leaving the screen mid-analysis).
  async function setFileInput(selector, filePath) {
    const { result } = await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    if (!result || !result.objectId) {
      throw new Error(`setFileInput: no element matches ${selector}`);
    }
    await send('DOM.setFileInputFiles', { files: [filePath], objectId: result.objectId });
    await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.dispatchEvent(new Event('change', { bubbles: true })); })()`
    );
  }

  // Overrides the rendered viewport size, the same Emulation domain
  // `reducedMotion` above already uses -- headless Chrome has no real window
  // to resize, so this (not a `--window-size` launch flag, which only sets
  // the OS-level window and is fixed for the browser's whole lifetime) is
  // how a single already-running page is made to render as a phone or a
  // desktop between screenshots. `mobile: true` also flips the CSS
  // `(pointer: coarse)`/viewport-meta handling Chrome applies for touch
  // devices, so a phone capture matches what a phone actually renders, not a
  // desktop page merely squeezed narrower.
  async function setViewport({ width, height, mobile = false, deviceScaleFactor = 1 }) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, mobile, deviceScaleFactor, screenWidth: width, screenHeight: height });
  }

  // Dispatches a real keyDown+keyUp pair over CDP's Input domain -- the same
  // physical event stream a real keyboard produces, so a journey test can
  // reach and activate controls with Tab/Enter/Space alone and never fall
  // back to `.click()`. `key` is the DOM key name ('Tab', 'Enter', ' ' for
  // Space); `text` (only needed for a character the page's own keypress
  // handler reads) and `modifiers` (CDP's bitmask: Alt 1, Ctrl 2, Meta 4,
  // Shift 8) default to what a plain, unmodified press sends. Chrome's
  // Input.dispatchKeyEvent also wants `windowsVirtualKeyCode` for the keys
  // this suite presses -- Tab 9, Enter 13, Space 32 -- so callers that name
  // one of those three get it filled in for free.
  // Chrome only runs a key's native default action (a focused button's
  // Enter/Space activation, Tab moving focus) off a 'keyDown' event that
  // ALSO carries the character it produces as `text` -- the same shape
  // Puppeteer's own keyboard.press() sends. Measured directly against this
  // build: 'keyDown' with no `text` (or CDP's 'rawKeyDown') left a focused
  // #playBtn un-clicked and #picker still open on Enter; adding `text`
  // fixed it. Tab produces no character of its own but still needs an
  // explicit empty `text` marker for the same reason -- Chrome otherwise
  // treats the event as a no-op key with nothing to act on.
  const VIRTUAL_KEY_CODES = { Tab: 9, Enter: 13, ' ': 32 };
  const DEFAULT_TEXT = { Tab: '', Enter: '\r', ' ': ' ' };
  async function press(key, { text = DEFAULT_TEXT[key] ?? '', modifiers = 0 } = {}) {
    const windowsVirtualKeyCode = VIRTUAL_KEY_CODES[key];
    const base = { key, code: key === ' ' ? 'Space' : key, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text, unmodifiedText: text, ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  // Captures the current viewport as a PNG and writes it to `outputPath`,
  // creating any missing parent directory (dist/ may not exist yet on a
  // clean checkout). `Page.captureScreenshot` returns base64; there is no
  // streaming form over CDP, so the whole image is held in memory once --
  // fine at the sizes this app ever renders at.
  async function screenshot(outputPath) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, Buffer.from(data, 'base64'));
  }

  // ---- Real input -------------------------------------------------------
  // Pointer events from the browser's own input pipeline (Input domain): the
  // page sees trusted events and a real user gesture, as for a person's mouse
  // or finger. Nothing here calls .click() or dispatches an Event in the page.
  async function click(x, y, { button = 'left', clickCount = 1 } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: 1, clickCount });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount });
  }
  async function tap(x, y) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // Press at `from`, move through `steps` points on the way, release at `to`.
  async function drag(from, to, { steps = 8 } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  // Where a person would aim at `selector`: the centre of its box, or for an
  // inline label that wraps, the centre of the first line box whose words are
  // really there (the middle of a wrapped box can be empty). A control off
  // screen is first scrolled into view by the driver (el.scrollIntoView() in the
  // page, not wheel input); reading the box is observation, not input. Missing,
  // hidden, disabled or covered controls are errors: a person could not click them.
  async function centreOf(selector) {
    const r = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'no element matches ' + ${JSON.stringify(selector)} };
      if (el.hidden || el.disabled) return { error: ${JSON.stringify(selector)} + ' is ' + (el.hidden ? 'hidden' : 'disabled') };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return { error: ${JSON.stringify(selector)} + ' has no size on screen' };
      const mine = (h) => h && (el === h || el.contains(h));
      const lines = [...el.getClientRects()].filter((q) => q.width && q.height);
      if (lines.length > 1) {
        for (const q of lines) {
          const lx = q.left + q.width / 2, ly = q.top + q.height / 2;
          if (mine(document.elementFromPoint(lx, ly))) return { x: lx, y: ly };
        }
      }
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!mine(hit)) return { error: ${JSON.stringify(selector)} + ' is covered at its centre by ' + (hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing') + ' (obscured)' };
      return { x, y };
    })()`);
    if (r.error) throw new Error(`cannot click: ${r.error}`);
    return r;
  }
  async function clickSelector(selector, opts) {
    const { x, y } = await centreOf(selector);
    await click(x, y, opts);
  }
  async function tapSelector(selector) {
    const { x, y } = await centreOf(selector);
    await tap(x, y);
  }

  // ---- Browser-level permissions ---------------------------------------
  // Answered in the browser's permission store (Browser domain), where a
  // person's Allow / Block lands, not by a launch flag. Not scoped to an
  // origin: Chrome refuses one for a file:// page ("opaque origins"), and each
  // launch has its own throwaway profile, so it only reaches this launch.
  const GRANT_NAME = { microphone: 'audioCapture', camera: 'videoCapture', midi: 'midi', 'midi-sysex': 'midiSysex' };
  const DESCRIPTOR = { microphone: { name: 'microphone' }, camera: { name: 'camera' }, midi: { name: 'midi' }, 'midi-sysex': { name: 'midi', sysex: true } };
  function permissionNames(names) {
    for (const n of names) if (!GRANT_NAME[n]) throw new Error(`unknown permission "${n}"; use one of ${Object.keys(GRANT_NAME).join(', ')}`);
    return names;
  }
  async function grant(names) {
    await browser.send('Browser.grantPermissions', { permissions: permissionNames(names).map((n) => GRANT_NAME[n]) });
  }
  async function deny(names) {
    for (const n of permissionNames(names)) await browser.send('Browser.setPermission', { permission: DESCRIPTOR[n], setting: 'denied' });
  }
  async function resetPermissions() {
    await browser.send('Browser.resetPermissions');
  }

  // ---- Background and return, for real -----------------------------------
  // A second tab brought forward really hides this one; activating this one
  // again shows it. The proof is the page's own recorded visibilitychange
  // events (visibilityLog), never an event a test dispatched.
  let otherTargetId = null;
  async function background() {
    if (otherTargetId) return;
    ({ targetId: otherTargetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
    await browser.send('Target.activateTarget', { targetId: otherTargetId });
    await waitFor("document.visibilityState === 'hidden'");
  }
  async function foreground() {
    await browser.send('Target.activateTarget', { targetId });
    await waitFor("document.visibilityState === 'visible'");
    if (otherTargetId) {
      const gone = otherTargetId;
      otherTargetId = null;
      await browser.send('Target.closeTarget', { targetId: gone }).catch(() => {});
    }
  }
  function visibilityLog() {
    return evaluate('window.__bcVisibility || []');
  }

  // ---- Audio, observed from outside the page -----------------------------
  // The WebAudio domain reports each AudioContext's state to the driver, so
  // "sound started" needs no hook in the app. Empty unless acceptance.
  const audio = {
    contexts: () => [...audioContexts.values()].map((c) => ({ ...c, history: [...c.history] })),
    running: () => [...audioContexts.values()].filter((c) => c.state === 'running').map((c) => ({ ...c, history: [...c.history] })),
    async waitForRunning(timeoutMs = WAIT_FLOOR_MS) {
      timeoutMs = effectiveWaitMs(timeoutMs);
      const start = Date.now();
      while (!audio.running().length) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`no AudioContext was running after ${timeoutMs}ms; WebAudio reported ${JSON.stringify(audio.contexts())}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };

  async function waitFor(expression, timeoutMs = WAIT_FLOOR_MS) {
    timeoutMs = effectiveWaitMs(timeoutMs);
    const start = Date.now();
    for (;;) {
      const ok = await evaluate(`Boolean(${expression})`);
      if (ok) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitFor timed out after ${timeoutMs}ms: ${expression}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function close() {
    try {
      await browser.send('Target.closeTarget', { targetId });
    } catch (e) {
      // already gone
    }
    browserWs.close();
    killGroup();
    try {
      rmSync(userDataDir, profileRmOptions());
    } catch (e) {
      // best-effort cleanup
    }
  }

  let identity;
  if (acceptance) {
    const { product, userAgent } = await browser.send('Browser.getVersion');
    const bytes = readFileSync(htmlFile);
    identity = {
      html: { path: htmlPath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      browser: { product, userAgent, binary: bin },
      flags: launchFlags,
      simulated: [
        'fake microphone device (--use-fake-device-for-media-stream)' +
          (fakeAudioFile ? `, playing ${fakeAudioFile}` : ', playing its built-in test tone'),
        ...(options.simulated || []),
      ],
    };
  }

  return {
    evaluate,
    reload,
    waitFor,
    setFileInput,
    setViewport,
    press,
    click,
    tap,
    drag,
    clickSelector,
    tapSelector,
    grant,
    deny,
    resetPermissions,
    background,
    foreground,
    visibilityLog,
    audio,
    // Raw DevTools access for a test that needs a domain this driver does not
    // wrap: dialogs, downloads, network conditions, emulated media. send() goes
    // to this page's session and browserSend() to the browser; on(fn) sees this
    // page's events until the function it returns is called.
    cdp: {
      send,
      browserSend: (method, params) => browser.send(method, params),
      on(fn) {
        page.listeners.add(fn);
        return () => page.listeners.delete(fn);
      },
    },
    screenshot,
    close,
    consoleErrors,
    consoleWarnings,
    logEntries,
    requestDetails,
    exceptions,
    requests,
    identity,
    binary: bin,
    pid: child.pid,
    profileDir: userDataDir,
  };
  }
}

// Bounded retry for a browser measurement that a starved runner can spoil.
//
// The audio characterization tests were the single biggest source of red on
// this repo: of the five ci.yml failures in a 38-run window on 2026-09-20,
// ALL FIVE were audio tests (the tuner confirming a steady tone, and three
// mic-routing tests), and none was a code defect. The decisive evidence:
// runs 35543924762 (red) and 35543940885 (green) were the same commit,
// 662dab55e, on a PR touching only store/ and one unrelated unit test.
//
// These tests drive a real AudioContext fed by Chrome's fake-audio-file path.
// When the box is oversubscribed the frames arrive late and jittery, and the
// measurement reads as silence or as a wildly wandering pitch.
//
// Retry is the right instrument here and a widened tolerance is not. A wide
// cents spread, or a freq of 0, is ALSO what a genuine regression in the
// capture or detection path would produce — so loosening the assertion, or
// skipping when the input looks bad, would blind the test to the one class of
// bug it exists to catch. A bounded retry does not make that trade: a
// deterministic regression fails every attempt, while transient starvation
// does not survive three fresh browsers.
//
// `attempt` must be self-contained — its own page, closed before it returns —
// so attempts cannot contaminate each other. Every attempt's description is
// kept and reported together on failure, because "which attempts failed and
// how" is the difference between diagnosing the runner and diagnosing the app.
//
// A discarded attempt is also written to stderr when it is discarded, so a run
// that PASSES on its second try still shows it threw one away; otherwise a
// measurement failing half the time reads like a healthy one. Done here, not
// at the ~30 call sites; a first-attempt success prints nothing.
export async function retryFlaky({ attempts = 3, attempt, accept, describe, what }) {
  const seen = [];
  for (let i = 0; i < attempts; i++) {
    const result = await attempt(i);
    if (accept(result)) return result;
    seen.push(`attempt ${i + 1}: ${describe ? describe(result) : JSON.stringify(result)}`);
    console.warn(`retryFlaky: ${what} -- discarded ${seen[seen.length - 1]} (${i + 1} of ${attempts} attempts used)`);
  }
  const err = new Error(
    `${what} did not succeed in ${attempts} independent attempts -- ${seen.join('; ')}. ` +
      'Failing on EVERY attempt points at the app; failing on one points at a starved runner.',
  );
  err.attempts = seen;
  throw err;
}

// Real device widths a learner reads this app at, plus one "text enlarged"
// pass -- for a nav-readable-widths/songs-lesson-first style test that wants
// to run the SAME assertions across all of them instead of hand-rolling a
// setViewport() loop per file. `mobile: true` on tablet too: measured
// directly against real devices, a 768-wide iPad in portrait still reports
// touch-pointer media features the same way a phone does, unlike a
// mouse-driven 768-wide desktop window.
export const VIEWPORTS = {
  phone: { width: 390, height: 844, mobile: true },
  tablet: { width: 768, height: 1024, mobile: true },
  desktop: { width: 1280, height: 800, mobile: false },
};

// Runs `run({ name, width, height })` once per real viewport above, then
// once more at phone width with text genuinely enlarged. src/styles.css
// (checked directly: no `rem` or `em` anywhere, every size a bare px value)
// has nothing for the standard "set html { font-size: 200% }" WCAG 1.4.4
// technique to scale -- it would change what 1rem equals and move nothing,
// since nothing here is sized in rem. The non-standard CSS `zoom` property
// Chromium supports is what actually enlarges rendered text/controls
// regardless of what unit they were authored in (measured directly against
// this build: #playBtn's own rendered box doubled, 129.7x51 -> 259.5x103,
// under `zoom: 200%`) -- so that, not a root font-size, is the mechanism
// used here. `innerWidth`/`innerHeight` are read back AFTER zooming rather
// than assumed, because Chromium's own reported layout viewport at 200% zoom
// does not simply halve (measured: 390x844 -> 529x1145, not 195x422) -- a
// caller comparing element rects against a guessed viewport would be
// comparing against the wrong number. The zoomed pass still leaves the
// button consuming a bigger share of that viewport than before (129.7/390 =
// 33% unzoomed vs 259.5/529 = 49% zoomed), so it is a genuinely harder
// layout constraint, not a no-op.
// Each pass leaves viewport switching to the caller's own `run` -- a caller
// with state already on screen (a song already open, already scrolled to
// wherever its own focus() call put it) decides whether that state should
// carry over into the next size or be rebuilt fresh; this helper does not
// scroll or otherwise touch the page itself between passes, only the
// viewport metrics.
export async function withViewports(page, run) {
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewport(vp);
    await run({ name, width: vp.width, height: vp.height, zoomed: false });
  }
  await page.setViewport(VIEWPORTS.phone);
  await page.evaluate("document.documentElement.style.zoom = '200%'");
  const width = await page.evaluate('innerWidth');
  const height = await page.evaluate('innerHeight');
  await run({ name: 'phone-200%-text', width, height, zoomed: true });
  await page.evaluate("document.documentElement.style.zoom = ''");
}

// ---- Acceptance mode: running a test, and keeping the evidence ----------
//
// launchPage(path, { acceptance: true }) is this driver run the way a person's
// browser runs. The default launch allows autoplay, answers the mic prompt by
// flag and keeps only console errors, so candidate e4b6fb5 passed every test and
// failed its first hand run (docs/release-acceptance-record.md). An acceptance
// launch uses a full Chrome, leaves autoplay and permissions to the browser
// (page.grant / page.deny answer them), keeps warnings, the browser Log and
// request initiators, watches AudioContexts through WebAudio, and refuses a
// page with the debug hook. Only the fake mic DEVICE is simulated; the identity
// block says so.

const identityReported = new Set();

// One line per fact, once per test file, in node --test's output.
function reportIdentity(t, id) {
  const key = t.filePath || '';
  if (identityReported.has(key)) return;
  identityReported.add(key);
  const diag = (m) => (typeof t.diagnostic === 'function' ? t.diagnostic(m) : console.log(m));
  diag(`acceptance html: ${id.html.path} sha256 ${id.html.sha256} (${id.html.bytes} bytes)`);
  diag(`acceptance browser: ${id.browser.product} (${id.browser.binary})`);
  diag(`acceptance flags: ${id.flags.join(' ')}`);
  diag(`acceptance simulated: ${id.simulated.join('; ')}`);
}

const safeName = (x) => String(x).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';

// Writes what a person would have seen to <artifactRoot>/<test file>/<test name>/.
async function writeFailureArtifacts(t, page, err, artifactRoot) {
  const dir = join(artifactRoot, safeName(basename(t.filePath || 'unknown-test-file')), safeName(t.name || 'unnamed-test'));
  mkdirSync(dir, { recursive: true });
  let shot = 'screenshot.png written';
  try {
    await page.screenshot(join(dir, 'screenshot.png'));
  } catch (e) {
    shot = `no screenshot: ${e.message}`;
  }
  const json = (name, v) => writeFileSync(join(dir, name), JSON.stringify(v, null, 2) + '\n');
  json('console.json', { errors: page.consoleErrors, warnings: page.consoleWarnings, exceptions: page.exceptions });
  json('log.json', page.logEntries);
  json('requests.json', page.requestDetails);
  json('identity.json', page.identity);
  writeFileSync(join(dir, 'error.txt'), `${err && err.stack ? err.stack : String(err)}\n\n${shot}\n`);
  return dir;
}

// Runs `fn(page)` on a fresh acceptance page and always closes it; on failure
// the evidence is written and the ORIGINAL error rethrown. `opts` are
// launchPage's plus `htmlPath` and `artifactRoot` (default dist/test-artifacts).
export async function withAcceptancePage(t, opts, fn) {
  const { htmlPath = acceptanceHtmlPath(), artifactRoot = fileURLToPath(new URL('../../dist/test-artifacts', import.meta.url)), ...launchOpts } = opts || {};
  const page = await launchPage(htmlPath, { ...launchOpts, acceptance: true });
  try {
    reportIdentity(t, page.identity);
    return await fn(page);
  } catch (err) {
    try {
      await writeFailureArtifacts(t, page, err, artifactRoot);
    } catch (e2) {
      console.warn(`acceptance: could not write failure artifacts: ${e2.message}`);
    }
    throw err;
  } finally {
    await page.close();
  }
}
