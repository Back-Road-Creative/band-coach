// Intentionally minimal: the app needs no privileged bridge into the
// renderer (nothing is exposed via contextBridge; contextIsolation is on and
// nodeIntegration is off, see main.js). All this does is mark <html> as the
// Store shell (data-shell="store"). The shell blocks every network request (main.js
// installNetworkBlock) and the Store delivers updates, so the page's "Check
// for updates" and "Download model pack" groups could only ever fail;
// src/styles.css hides them under this attribute. A sandboxed preload runs
// before the page has an <html> element, hence the wait.
'use strict';
const mark = () => document.documentElement.setAttribute('data-shell', 'store');
if (document.documentElement) mark();
else document.addEventListener('DOMContentLoaded', mark);
