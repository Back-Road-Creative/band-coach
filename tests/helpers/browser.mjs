// Drives a real headless Chromium over the Chrome DevTools Protocol using only
// Node 22 built-ins (global WebSocket + fetch, node:child_process, node:fs,
// node:os). No npm dependency — see site-headlessmode/scripts/preview-overflow.mjs
// for the precedent this borrows its connection pattern from.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir, availableParallelism, loadavg } from 'node:os';
import { join, dirname } from 'node:path';

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

function onPath(name) {
  const dirs = (process.env.PATH || '').split(':');
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

// Talks JSON-RPC over one DevTools WebSocket connection.
class DevtoolsClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
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

// Spawns the browser and resolves once "DevTools listening on ws://..." is
// seen on stderr, extracting the port that was actually bound (we always ask
// for port 0 so parallel test files never collide).
export function spawnBrowser(bin, userDataDir, extraArgs = [], { launchTimeoutMs = 15000 } = {}) {
  const args = [
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...extraArgs,
    'about:blank',
  ];
  if (process.env.CI) args.splice(1, 0, '--no-sandbox');
  // Its own process group (detached), so cleanup can kill the renderer, GPU
  // and zygote processes too, not just the launched parent: those are
  // separate processes that a plain child.kill() never touches, and they
  // survive as orphans (101 observed piled up on the box before this fix).
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
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
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        // already gone, or never started
      }
      child.stderr.destroy();
      err.child = child;
      reject(err);
    };
    const onErr = (err) => fail(err);
    child.once('error', onErr);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        child.off('error', onErr);
        resolve({ child, browserWsUrl: m[1] });
      }
    });
    child.once('exit', (code) => {
      if (!buf.includes('DevTools listening')) {
        fail(new Error(`browser exited (code ${code}) before DevTools was ready. stderr:\n${buf}`));
      }
    });
    timer = setTimeout(() => fail(new Error('timed out waiting for DevTools listening line')), launchTimeoutMs).unref();
  });
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
// Only BOOT_DEADLINE is retried. Every other error propagates on the first
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
      if (!err || err.code !== BOOT_DEADLINE_CODE) throw err;
      last = err;
    }
  }
  const err = bootDeadlineError(BOOT_DEADLINE_MS);
  err.message = `${last ? last.message : err.message} -- and again in ${attempts} attempts, each with a fresh browser. Failing every time points at the app or the build, not at a busy runner.`;
  err.attempts = attempts;
  throw err;
}

export function launchPage(htmlPath, options = {}) {
  return retryOnBootDeadline(() => launchPageOnce(htmlPath, options));
}

async function launchPageOnce(htmlPath, options = {}) {
  const { fakeAudioFile, initScript } = options;
  const bin = findBrowserBinary();
  if (!bin) {
    throw new Error(
      'No Chromium-family browser found. Set CHROME_BIN, or install one of: ' +
        'the Playwright headless shell (~/.cache/ms-playwright/chromium_headless_shell-*), ' +
        'google-chrome, google-chrome-stable, chromium, chromium-browser.'
    );
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'band-coach-cdp-'));
  const extraArgs = fakeAudioFile ? [`--use-file-for-fake-audio-capture=${fakeAudioFile}`] : [];
  const { child, browserWsUrl } = await spawnBrowser(bin, userDataDir, extraArgs);

  // child.pid is the process GROUP id too, since spawnBrowser starts it
  // detached (group leader). Kills the whole group, not just this one
  // process — a surviving renderer/GPU/zygote process would otherwise
  // recreate userDataDir the instant rmSync below removes it.
  function killGroup() {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (e) {
      // already gone
    }
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
      rmSync(userDataDir, { recursive: true, force: true });
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

  page.listeners.add((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
    } else if (msg.method === 'Network.requestWillBeSent') {
      requests.push(msg.params.request.url);
    }
  });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('DOM.enable');
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

  const url = 'file://' + htmlPath;

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
  // a real 'change' event afterwards so the page's own listener fires.
  async function setFileInput(selector, filePath) {
    const { result } = await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    if (!result || !result.objectId) {
      throw new Error(`setFileInput: no element matches ${selector}`);
    }
    await send('DOM.setFileInputFiles', { files: [filePath], objectId: result.objectId });
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`
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
      rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      // best-effort cleanup
    }
  }

  return {
    evaluate,
    reload,
    waitFor,
    setFileInput,
    setViewport,
    screenshot,
    close,
    consoleErrors,
    exceptions,
    requests,
    binary: bin,
    pid: child.pid,
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
export async function retryFlaky({ attempts = 3, attempt, accept, describe, what }) {
  const seen = [];
  for (let i = 0; i < attempts; i++) {
    const result = await attempt(i);
    if (accept(result)) return result;
    seen.push(`attempt ${i + 1}: ${describe ? describe(result) : JSON.stringify(result)}`);
  }
  const err = new Error(
    `${what} did not succeed in ${attempts} independent attempts -- ${seen.join('; ')}. ` +
      'Failing on EVERY attempt points at the app; failing on one points at a starved runner.',
  );
  err.attempts = seen;
  throw err;
}
