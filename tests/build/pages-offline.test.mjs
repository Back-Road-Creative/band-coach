// Proves the "phone copy" edition actually installs as an offline-capable
// PWA: serves dist/pages/ from a throwaway node:http server bound to
// 127.0.0.1 only (loopback — never a real network listener), drives it in
// headless Chromium, waits for the service worker to reach "activated", then
// stops the server and reloads the SAME page: if that still renders instead
// of failing to load, the cache-first app shell is doing its job.
//
// Deliberately does not import tests/helpers/browser.mjs: that helper only
// ever navigates to file:// URLs, and a service worker requires a secure
// context (https:, or the loopback hostnames localhost/127.0.0.1) — file://
// pages can never register one. This file borrows the same
// browser-discovery/CDP technique in miniature, scoped to just what this one
// test needs (navigate to an http:// URL, evaluate script, reload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:http';
import { buildPages } from '../../build/pages.mjs';

// Nothing to restore: this file builds only into its own throwaway
// directories and never writes dist/, so it cannot disturb another test file.

function findPlaywrightHeadlessShell() {
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-'));
  dirs.sort();
  for (const d of dirs.reverse()) {
    const bin = join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(bin)) return bin;
  }
  return null;
}

function onPath(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
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

const MIME_TYPES = {
  '.html': 'text/html',
  '.webmanifest': 'application/manifest+json',
  '.js': 'text/javascript',
  '.png': 'image/png',
};

// A loopback-only static file server for dist/pages/ — 127.0.0.1 explicitly,
// never 0.0.0.0, so it is never reachable off this machine.
function serveDirLoopback(dir) {
  const server = createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    try {
      const data = readFileSync(join(dir, reqPath));
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(reqPath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function launchHttpPage(url) {
  const bin = findBrowserBinary();
  if (!bin) {
    throw new Error(
      'No Chromium-family browser found. Set CHROME_BIN, or install one of: ' +
        'the Playwright headless shell (~/.cache/ms-playwright/chromium_headless_shell-*), ' +
        'google-chrome, google-chrome-stable, chromium, chromium-browser.'
    );
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'band-coach-offline-cdp-'));
  const args = [
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
  ];
  if (process.env.CI) args.splice(1, 0, '--no-sandbox');
  args.push('about:blank');
  // Its own process group (detached), so cleanup can kill the renderer, GPU
  // and zygote processes too, not just the launched parent: those are
  // separate processes that a plain child.kill() never touches, and they
  // survive as orphans piling up on the box.
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  // child.pid is the process GROUP id too, since it is spawned detached
  // (group leader). Kills the whole group, not just this one process.
  function killGroup() {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (e) {
      // already gone
    }
  }

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
  const browserWsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const onErr = (err) => reject(err);
    child.once('error', onErr);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        child.off('error', onErr);
        resolve(m[1]);
      }
    });
    child.once('exit', (code) => {
      if (!buf.includes('DevTools listening')) reject(new Error(`browser exited (code ${code}): ${buf}`));
    });
    setTimeout(() => reject(new Error('timed out waiting for DevTools listening line')), 15000).unref();
  });

  const browserWs = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    browserWs.addEventListener('open', () => resolve(), { once: true });
    browserWs.addEventListener('error', (e) => reject(new Error('websocket error: ' + (e.message || e.type))), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  function send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      browserWs.send(JSON.stringify(payload));
    });
  }
  const listeners = new Set();
  browserWs.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  // Timed, not open-ended: under heavy load Chromium can spawn and open its
  // DevTools socket fine but never actually fire the page's load event, and
  // with no deadline here `await waitForLoad()` then blocks forever at 0%
  // CPU instead of failing loudly.
  function waitForLoad(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
          listeners.delete(handler);
          clearTimeout(timer);
          resolve();
        }
      };
      listeners.add(handler);
      const timer = setTimeout(() => {
        listeners.delete(handler);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for Page.loadEventFired`));
      }, timeoutMs);
    });
  }

  async function evaluate(expression) {
    const result = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    );
    if (result.exceptionDetails) {
      throw new Error(
        'evaluate failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      );
    }
    return result.result.value;
  }

  async function goto(targetUrl) {
    const loaded = waitForLoad();
    await send('Page.navigate', { url: targetUrl }, sessionId);
    await loaded;
    await new Promise((r) => setTimeout(r, 150));
  }

  async function reload() {
    const loaded = waitForLoad();
    await send('Page.reload', { ignoreCache: false }, sessionId);
    await loaded;
    await new Promise((r) => setTimeout(r, 150));
  }

  await goto(url);

  async function close() {
    try {
      await send('Target.closeTarget', { targetId });
    } catch {
      // already gone
    }
    browserWs.close();
    killGroup();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  return { evaluate, reload, close, pid: child.pid };
  }
}

test('phone-copy service worker activates and the page still renders offline after a reload', { timeout: 30000 }, async (t) => {
  // Its OWN directory, never the shared dist/pages/: node:test runs test
  // FILES concurrently, and pages.test.mjs rebuilds dist/pages/ — which starts
  // by deleting it. Sharing it made this test serve an emptied directory and
  // read back a blank document.title.
  const ownDir = mkdtempSync(join(tmpdir(), 'band-coach-pages-'));
  const ownBuildDir = mkdtempSync(join(tmpdir(), 'band-coach-build-'));
  t.after(() => {
    rmSync(ownDir, { recursive: true, force: true });
    rmSync(ownBuildDir, { recursive: true, force: true });
  });
  const pagesDir = await buildPages({ outDir: ownDir, buildDir: ownBuildDir });
  const server = await serveDirLoopback(pagesDir);
  // Unconditional cleanup: the test below stops the server on purpose
  // half-way through, but if any assertion before that point fails the server
  // stays listening and node can never exit — the run hangs instead of
  // reporting the failure. closeAllConnections() is required as well as
  // close(), because the browser holds a keep-alive socket that close() waits
  // on forever.
  let serverClosed = false;
  const closeServer = () =>
    new Promise((resolve) => {
      if (serverClosed) return resolve();
      serverClosed = true;
      server.closeAllConnections();
      server.close(resolve);
    });
  t.after(closeServer);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  const page = await launchHttpPage(url);
  t.after(() => page.close());

  assert.equal(await page.evaluate("'serviceWorker' in navigator"), true);
  assert.equal(await page.evaluate('document.title'), 'Band Coach');

  const start = Date.now();
  let swState = null;
  while (Date.now() - start < 15000) {
    swState = await page.evaluate(`
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration('./');
        if (!reg) return 'no-registration';
        return reg.active ? reg.active.state : 'no-active';
      })()
    `);
    if (swState === 'activated') break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (swState !== 'activated') {
    // Say WHY, not just that it did not happen: register() rejects with the
    // real reason (a bad MIME type, a parse error in sw.js, a failed
    // precache fetch), and without this the failure reads as a mystery.
    const why = await page.evaluate(
      "navigator.serviceWorker.register('./sw.js').then(() => 'registered ok').catch(e => 'register rejected: ' + e)"
    );
    assert.fail(`the service worker should reach the activated state, got "${swState}" — ${why}`);
  }

  const bodyLenOnline = await page.evaluate('document.body.innerHTML.length');
  assert.ok(bodyLenOnline > 1000, 'the app shell rendered while online');

  await closeServer();

  await page.reload();

  const titleOffline = await page.evaluate('document.title');
  const bodyLenOffline = await page.evaluate('document.body.innerHTML.length');
  assert.equal(titleOffline, 'Band Coach', 'the title still renders after the server is stopped');
  assert.ok(
    bodyLenOffline >= bodyLenOnline * 0.9,
    `the app shell should still render offline (online body length ${bodyLenOnline}, offline ${bodyLenOffline})`
  );

  // The instrument picker is part of the app shell, not fetched separately —
  // proves this is the real cached app, not an empty error page.
  const hasPicker = await page.evaluate("document.getElementById('picker') !== null");
  assert.equal(hasPicker, true, 'the instrument picker element is present in the offline-served page');
});
