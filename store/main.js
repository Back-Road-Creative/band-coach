// Band Coach — Windows Store desktop shell.
//
// This is a thin Electron wrapper around the SAME one-file app the browser
// build ships (app/band-coach.html, staged here by scripts/prepare-app.mjs
// from ../dist/{release/,}band-coach.html). It adds no app logic: one
// window, no network, no telemetry, no remote content, ever.
//
// Progress persistence: nothing extra is wired up here on purpose. The
// bundled page already keeps its own state in `localStorage`; Electron
// gives that `file://` origin's localStorage a real per-app profile
// directory under Electron's userData path (see app.setPath('userData', ...)
// below and the default per-platform location Electron picks), so progress
// now survives across launches without the app code knowing anything about
// desktop persistence.
'use strict';

const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isAllowed, ALLOWED_PERMISSIONS } = require('./lib/permission-policy.js');
const { SMOKE_FLAG, smokeExitCode } = require('./lib/smoke.js');

const APP_HTML_PATH = path.join(__dirname, 'app', 'band-coach.html');
const APP_FILE_URL = pathToFileURL(APP_HTML_PATH).href;

function isAppUrl(url) {
  return url === APP_FILE_URL;
}

function isAllowedNavigationTarget(url) {
  // The app is one page with no internal navigation targets of its own;
  // only the exact file it was loaded from is ever legitimate.
  return isAppUrl(url);
}

function installNetworkBlock(ses) {
  // Block every network request. The app is a single local file with no
  // fetches of its own, so this should never observe legitimate traffic —
  // it exists to make "never phones home" an enforced property, not a
  // promise. `file:` covers the loaded page and any assets it references
  // from disk; `blob:`/`data:` cover in-page constructs such as
  // AudioWorklet/Worker code loaded from a Blob URL.
  const ALLOWED_PROTOCOLS = new Set(['file:', 'blob:', 'data:']);
  ses.webRequest.onBeforeRequest((details, callback) => {
    let protocol;
    try {
      protocol = new URL(details.url).protocol;
    } catch {
      protocol = '';
    }
    callback({ cancel: !ALLOWED_PROTOCOLS.has(protocol) });
  });
}

function installPermissionHandler(ses) {
  // The decision itself lives in the pure, Electron-free
  // ./lib/permission-policy.js (unit-tested without Electron at
  // tests/unit/store-permission-policy.test.mjs). Both handlers pass every
  // identifying argument Electron gives them: `requestingUrl` from
  // `details` (documented for both handlers) and the WebContents' own
  // current URL, never `requestingOrigin` alone — Chromium's origin
  // serialization for file:// pages is not guaranteed by Electron's docs
  // (see store/README.md, "What was NOT verified here").
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isAllowed({
        permission,
        requestingUrl: details && details.requestingUrl,
        webContentsUrl: webContents && webContents.getURL(),
        appFileUrl: APP_FILE_URL,
      })
    );
  });
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      return isAllowed({
        permission,
        requestingOrigin,
        requestingUrl: details && details.requestingUrl,
        webContentsUrl: webContents && webContents.getURL(),
        appFileUrl: APP_FILE_URL,
      });
    });
  }
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit', label: 'Quit' }],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.loadFile(APP_HTML_PATH),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
          click: () => win.setFullScreen(!win.isFullScreen()),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Band Coach',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Band Coach',
              message: 'Band Coach',
              detail:
                'Version ' +
                app.getVersion() +
                '\nRuns fully offline. Your sound never leaves your computer.',
            });
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(buildMenu(win));

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationTarget(url)) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // The app never legitimately opens a second window; anything a page
    // script asks to open externally goes to the OS browser instead of a
    // new Electron/Chromium window with its own capabilities.
    if (!isAppUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  win.loadFile(APP_HTML_PATH);
  return win;
}

// `--smoke-test` (store-package.yml runs the packaged exe with it): load the
// page, collect anything that went wrong, and exit with lib/smoke.js's
// verdict instead of staying open. A main-process crash before this runs
// shows an error dialog and never exits, which the workflow's timeout
// catches.
function runSmokeTest(win) {
  const state = { loaded: false, failedLoad: null, rendererGone: null, pageErrors: [] };
  const wc = win.webContents;
  const finish = () => app.exit(smokeExitCode(state));
  wc.on('console-message', (event, level, message) => {
    const lvl = typeof level === 'number' ? level : event && event.level;
    if (lvl === 3 || lvl === 'error') {
      state.pageErrors.push(String(message !== undefined ? message : event && event.message));
    }
  });
  wc.on('did-fail-load', (_event, _code, description) => {
    state.failedLoad = description || 'load failed';
  });
  wc.on('render-process-gone', (_event, details) => {
    state.rendererGone = (details && details.reason) || 'gone';
    finish();
  });
  wc.on('did-finish-load', () => {
    state.loaded = true;
    // Give start-up scripts a moment to throw before the verdict.
    setTimeout(finish, 3000);
  });
  setTimeout(finish, 45000);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    installNetworkBlock(session.defaultSession);
    installPermissionHandler(session.defaultSession);
    const win = createWindow();
    if (process.argv.includes(SMOKE_FLAG)) runSmokeTest(win);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

module.exports = {
  isAppUrl,
  isAllowedNavigationTarget,
  ALLOWED_PERMISSIONS,
};
