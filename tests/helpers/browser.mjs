// Drives a real headless Chromium over the Chrome DevTools Protocol using only
// Node 22 built-ins (global WebSocket + fetch, node:child_process, node:fs,
// node:os). No npm dependency — see site-headlessmode/scripts/preview-overflow.mjs
// for the precedent this borrows its connection pattern from.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

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
function spawnBrowser(bin, userDataDir, extraArgs = []) {
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
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    const onErr = (err) => reject(err);
    child.once('error', onErr);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        child.off('error', onErr);
        resolve({ child, browserWsUrl: m[1] });
      }
    });
    child.once('exit', (code) => {
      if (!buf.includes('DevTools listening')) {
        reject(new Error(`browser exited (code ${code}) before DevTools was ready. stderr:\n${buf}`));
      }
    });
    setTimeout(() => reject(new Error('timed out waiting for DevTools listening line')), 15000).unref();
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
export async function launchPage(htmlPath, options = {}) {
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

  const loaded = new Promise((resolve) => {
    const off = () => {};
    const handler = (msg) => {
      if (msg.method === 'Page.loadEventFired') {
        page.listeners.delete(handler);
        resolve();
      }
    };
    page.listeners.add(handler);
  });

  const url = 'file://' + htmlPath;
  await send('Page.navigate', { url });
  await loaded;
  // Let the app's own boot code (loadDB, buildPicker, first draw) settle.
  await new Promise((r) => setTimeout(r, 150));

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

  async function waitFor(expression, timeoutMs = 5000) {
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
    child.kill('SIGKILL');
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      // best-effort cleanup
    }
  }

  return {
    evaluate,
    waitFor,
    close,
    consoleErrors,
    exceptions,
    requests,
    binary: bin,
  };
}
