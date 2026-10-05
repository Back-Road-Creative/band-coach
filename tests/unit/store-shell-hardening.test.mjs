// Hardening checks for the Windows Store desktop shell (store/**): https-only
// external links, Electron fuses, and the preload flag that hides the two
// web-only blocks (update check, model pack). Plain `node --test`; Electron
// is stubbed, so nothing here needs store/node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const storeRoot = join(repoRoot, 'store');
const require = createRequire(import.meta.url);

function loadIsSafe() {
  let mod;
  try { mod = require(join(storeRoot, 'lib', 'external-url.js')); } catch { mod = null; }
  assert.ok(mod && typeof mod.isSafeExternalUrl === 'function', 'store/lib/external-url.js must export isSafeExternalUrl');
  return mod.isSafeExternalUrl;
}

test('isSafeExternalUrl allows plain https links', () => {
  const ok = loadIsSafe();
  assert.equal(ok('https://backroadcreative.com/band-coach/'), true);
  assert.equal(ok('HTTPS://example.com/a?b=1#c'), true);
});

test('isSafeExternalUrl refuses every other scheme', () => {
  const ok = loadIsSafe();
  for (const url of [
    'http://example.com/', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,hi',
    'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'vscode://x', 'mailto:a@b.c', 'ftp://example.com/', 'blob:https://example.com/x',
  ]) assert.equal(ok(url), false, url);
});

test('isSafeExternalUrl refuses junk, non-strings and credentialed or hostless https', () => {
  const ok = loadIsSafe();
  for (const url of ['', 'not a url', '//example.com', 'https://', 'https://user:pw@example.com/', 'https://user@example.com/', undefined, null, 42, {}])
    assert.equal(ok(url), false, String(url));
});

// Runs main.js against a stubbed electron and returns the window-open handler
// it installs, plus every URL handed to shell.openExternal.
function bootMain() {
  const opened = [];
  let openHandler = null;
  const win = {
    webContents: { on() {}, setWindowOpenHandler(fn) { openHandler = fn; } },
    loadFile() {}, isMinimized: () => false, isFullScreen: () => false, setFullScreen() {},
  };
  function BrowserWindow() { return win; }
  BrowserWindow.getAllWindows = () => [win];
  const electron = {
    app: {
      requestSingleInstanceLock: () => true, on() {}, quit() {}, exit() {}, getVersion: () => '0.0.0',
      whenReady: () => ({ then(cb) { cb(); return this; } }),
    },
    BrowserWindow,
    Menu: { setApplicationMenu() {}, buildFromTemplate: t => t },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    shell: { openExternal: url => { opened.push(url); return Promise.resolve(); } },
  };
  const mainPath = join(storeRoot, 'main.js');
  const origLoad = Module._load;
  delete require.cache[mainPath];
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : origLoad.call(this, request, ...rest); };
  try { require(mainPath); } finally { Module._load = origLoad; delete require.cache[mainPath]; }
  assert.ok(openHandler, 'main.js must install a window-open handler');
  return { openHandler, opened };
}

test('main.js hands only https URLs to the OS browser and always denies the window', () => {
  const { openHandler, opened } = bootMain();
  const cases = ['https://backroadcreative.com/band-coach/', 'http://example.com/', 'javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x'];
  for (const url of cases) assert.deepEqual(openHandler({ url }), { action: 'deny' }, url);
  assert.deepEqual(opened, ['https://backroadcreative.com/band-coach/']);
});

test('electron-builder.json turns off runAsNode and the inspector/NODE_OPTIONS fuses and locks the asar', () => {
  const cfg = JSON.parse(readFileSync(join(storeRoot, 'electron-builder.json'), 'utf8'));
  assert.ok(cfg.electronFuses && typeof cfg.electronFuses === 'object', 'electron-builder.json needs an electronFuses block');
  assert.equal(cfg.electronFuses.runAsNode, false);
  assert.equal(cfg.electronFuses.enableNodeCliInspectArguments, false);
  assert.equal(cfg.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(cfg.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(cfg.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  // The app is loaded from file://, so that fuse must not be switched off, and the asar must stay on.
  assert.notEqual(cfg.electronFuses.grantFileProtocolExtraPrivileges, false);
  assert.notEqual(cfg.asar, false);
});

// Runs preload.js the way a sandboxed preload sees the world: only `electron`
// can be required, and the page's <html> may not exist until DOMContentLoaded.
function runPreload() {
  const classes = new Set(), listeners = {};
  const html = { classList: { add: c => classes.add(c) } };
  let parsed = false;
  const doc = {
    get documentElement() { return parsed ? html : null; },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
  const sandboxRequire = id => {
    if (id !== 'electron') throw new Error('a sandboxed preload can only require electron, not ' + id);
    return {};
  };
  vm.runInNewContext(readFileSync(join(storeRoot, 'preload.js'), 'utf8'), { require: sandboxRequire, document: doc, window: {} });
  parsed = true;
  (listeners.DOMContentLoaded || []).forEach(fn => fn());
  return { classes };
}

test('preload marks <html> as the Store shell', () => {
  const { classes } = runPreload();
  assert.ok(classes.has('bc-store-shell'), 'preload must add the bc-store-shell class to <html>');
});

test('styles.css hides the update-check and model-pack groups only under .bc-store-shell', () => {
  const css = readFileSync(join(repoRoot, 'src', 'styles.css'), 'utf8');
  const rule = css.match(/([^{}]*\.bc-store-shell[^{}]*)\{([^}]*)\}/);
  assert.ok(rule, 'styles.css needs a .bc-store-shell rule');
  assert.match(rule[1], /#updateCheckBtn/);
  assert.match(rule[1], /#modelPackBtn/);
  assert.match(rule[2], /display:\s*none/);
  assert.doesNotMatch(css.replace(rule[0], ''), /bc-store-shell/, 'one rule only');
});
