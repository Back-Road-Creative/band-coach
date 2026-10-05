// The hosted (Pages) copy under its real Content-Security-Policy, in a real
// browser. Serves the built dist/pages layout from a loopback http server
// (127.0.0.1 only) and proves three things the policy text alone cannot:
//   1. the app boots and a microphone drill starts its AudioWorklet pitch
//      listener (frames arrive from the worklet, not the setInterval fallback)
//      with ZERO securitypolicyviolation events;
//   2. the worklet really loaded from a blob: URL (data: is not allowed);
//   3. script an HTML-injection bug could plant -- an inline <script>, a
//      <script src="data:...">, and an inline event handler -- does not run
//      and raises a violation.
// It builds the RELEASE artifact into its own throwaway directories (never
// dist/), so it tests what ships; there is no window.__coach hook to lean on.
//
// Not launchPage(): that helper only opens file:// URLs, and a service worker
// and a CSP-over-http check both need an http origin. It borrows the shared
// spawnBrowser/DevtoolsClient and drives one page over its own websocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:http';
import { buildPages } from '../../build/pages.mjs';
import { spawnBrowser, retryOnBootDeadline, DevtoolsClient, killTree, effectiveWaitMs } from '../helpers/browser.mjs';

function findBrowserBinary() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(root)) {
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) {
      const bin = join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH || '').split(':')) {
      if (dir && existsSync(join(dir, name))) return join(dir, name);
    }
  }
  throw new Error('No Chromium-family browser found. Set CHROME_BIN or install the Playwright headless shell.');
}

const MIME = { '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

function serveLoopback(dir) {
  const server = createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    try {
      const data = readFileSync(join(dir, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
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

// A continuous tone so frames keep arriving whenever the test looks.
function writeToneWav(path, { freq = 196, sampleRate = 48000, seconds = 2 } = {}) {
  const n = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.6 * 32767), 44 + i * 2);
  writeFileSync(path, buf);
  return path;
}

// Runs before any page script. Records every CSP violation, every addModule
// URL scheme and its outcome, and every message the worklet node posts.
const INIT = `
  (function () {
    window.__bcViolations = [];
    document.addEventListener('securitypolicyviolation', function (e) {
      window.__bcViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample || '' });
    });
    window.__bcModules = [];
    var origAdd = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url) {
      var rec = { scheme: String(url).split(':')[0], ok: null };
      window.__bcModules.push(rec);
      var p = origAdd.apply(this, arguments);
      p.then(function () { rec.ok = true; }, function () { rec.ok = false; });
      return p;
    };
    window.__bcFrames = 0;
    var Orig = AudioWorkletNode;
    window.AudioWorkletNode = function (ctx, name, opts) {
      var node = new Orig(ctx, name, opts);
      node.port.addEventListener('message', function () { window.__bcFrames++; });
      return node;
    };
    window.AudioWorkletNode.prototype = Orig.prototype;
  })();
`;

async function openHosted(t) {
  const ownDir = mkdtempSync(join(tmpdir(), 'band-coach-csp-pages-'));
  const ownBuild = mkdtempSync(join(tmpdir(), 'band-coach-csp-build-'));
  const wav = writeToneWav(join(ownBuild, 'tone-196hz.wav'));
  t.after(() => {
    rmSync(ownDir, { recursive: true, force: true });
    rmSync(ownBuild, { recursive: true, force: true });
  });
  await buildPages({ outDir: ownDir, buildDir: ownBuild });
  const server = await serveLoopback(ownDir);
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const userDataDir = mkdtempSync(join(tmpdir(), 'band-coach-csp-cdp-'));
  const { child, browserWsUrl } = await retryOnBootDeadline(() =>
    spawnBrowser(findBrowserBinary(), userDataDir, [`--use-file-for-fake-audio-capture=${wav}`])
  );
  t.after(() => {
    killTree(child.pid);
    rmSync(userDataDir, { recursive: true, force: true });
  });
  const port = new URL(browserWsUrl).port;
  const browserWs = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    browserWs.addEventListener('open', resolve, { once: true });
    browserWs.addEventListener('error', () => reject(new Error('devtools websocket error')), { once: true });
  });
  t.after(() => browserWs.close());
  const browser = new DevtoolsClient(browserWs);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.id === targetId);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('page websocket error')), { once: true });
  });
  t.after(() => ws.close());
  const cdp = new DevtoolsClient(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms, what) => {
    const deadline = Date.now() + effectiveWaitMs(ms);
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  await cdp.send('Page.navigate', { url });
  await waitFor("document.readyState === 'complete' && document.documentElement.getAttribute('data-coach-ready') === '1'", 30000, 'the hosted app to boot');
  return { evaluate, waitFor };
}

test('hosted copy under its CSP: boots, runs the worklet from blob:, raises no violation, and refuses injected script', { timeout: 120000 }, async (t) => {
  const { evaluate, waitFor } = await openHosted(t);

  assert.equal(
    await evaluate("document.querySelectorAll('meta[http-equiv=\"Content-Security-Policy\"]').length"),
    1,
    'the hosted page must carry its CSP meta'
  );

  // A microphone drill: pick the guitar, press the mic button.
  await evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await evaluate("document.getElementById('ioBtn').click()");
  await waitFor("document.getElementById('ioBtn').hidden === true", 15000, 'the mic to start');
  await waitFor('window.__bcFrames > 5', 15000, 'frames from the AudioWorklet node (not the setInterval fallback)');
  await waitFor("parseFloat(document.getElementById('micLevelFill').style.width) > 0", 8000, 'the level meter to move');
  // The two on-press network features. The hosts may be unreachable from the test box, which is fine:
  // a failed fetch is not a violation, a CSP-refused one is.
  await evaluate("document.getElementById('updateCheckBtn').click()");
  await evaluate("document.getElementById('modelPackBtn').click()");
  await waitFor("!document.getElementById('updateCheckBtn').disabled && !document.getElementById('modelPackBtn').disabled", 30000, 'both press-to-fetch buttons to settle');
  // Let a service-worker registration and any deferred load surface a violation.
  await new Promise((r) => setTimeout(r, 500));

  const modules = await evaluate('JSON.stringify(window.__bcModules)');
  assert.deepEqual(JSON.parse(modules), [{ scheme: 'blob', ok: true }], `the worklet must load once, from blob:, got ${modules}`);
  const before = await evaluate('JSON.stringify(window.__bcViolations)');
  assert.equal(before, '[]', `a normal session under the CSP raised violations: ${before}`);

  // What an HTML-injection bug would try. None may run.
  await evaluate(`
    window.__inj = { inline: 0, data: 0, handler: 0, dataErrored: false };
    var s = document.createElement('script'); s.textContent = 'window.__inj.inline = 1'; document.body.appendChild(s);
    var d = document.createElement('script'); d.src = 'data:text/javascript,window.__inj.data = 1';
    d.addEventListener('error', function () { window.__inj.dataErrored = true; }); document.body.appendChild(d);
    var h = document.createElement('div'); h.innerHTML = '<img src="x:0" onerror="window.__inj.handler = 1">'; document.body.appendChild(h);
    true
  `);
  await waitFor('window.__inj.dataErrored && window.__bcViolations.length >= 3', 8000, 'the injected script to be refused');
  await new Promise((r) => setTimeout(r, 300));

  const inj = JSON.parse(await evaluate('JSON.stringify(window.__inj)'));
  assert.equal(inj.inline, 0, 'an injected inline <script> ran');
  assert.equal(inj.data, 0, 'an injected <script src="data:..."> ran');
  assert.equal(inj.handler, 0, 'an injected inline event handler ran');
  const violations = JSON.parse(await evaluate('JSON.stringify(window.__bcViolations)'));
  const has = (directive, blocked) => violations.some((v) => v.directive === directive && v.blocked === blocked);
  assert.ok(has('script-src-elem', 'inline'), `no violation for the inline <script>: ${JSON.stringify(violations)}`);
  assert.ok(has('script-src-elem', 'data'), `no violation for the data: script: ${JSON.stringify(violations)}`);
  assert.ok(has('script-src-attr', 'inline'), `no violation for the inline event handler: ${JSON.stringify(violations)}`);
});
