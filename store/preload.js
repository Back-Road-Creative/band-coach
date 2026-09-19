// Intentionally minimal: the app needs no privileged bridge into the
// renderer. contextIsolation is on and nodeIntegration is off (see
// main.js), so this file exists only because BrowserWindow.webPreferences
// expects a preload script; it exposes nothing via contextBridge.
'use strict';
