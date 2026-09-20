// Pure permission-decision policy for the Windows Store desktop shell.
//
// No Electron import on purpose: this is unit-tested with plain
// `node --test` (see tests/unit/store-permission-policy.test.mjs at the repo
// root), and it is the ONLY place that decides allow/deny so the decision is
// robust by construction rather than re-checked ad hoc in main.js.
//
// Electron's session.setPermissionCheckHandler / setPermissionRequestHandler
// pass a `requestingOrigin` (check handler only) and, on both handlers, a
// `details` object that can carry `requestingUrl` (the last URL the
// requesting frame loaded) and `securityOrigin` (for media/hid/usb/serial
// checks) — see
// https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler
// and #sessetpermissionrequesthandlerhandler. Chromium's origin
// serialization for `file:` pages is not documented there, and can differ
// across platforms/versions (e.g. "file://", "file:///", or the opaque
// string "null") — see store/README.md's "What was NOT verified here". This
// module therefore never trusts `requestingOrigin` alone: it only allows a
// request when a full URL (requestingUrl or the WebContents' own URL)
// parses as `file:` and points at the exact app HTML file. `requestingOrigin`
// is used only as a defense-in-depth veto — an origin that is unambiguously
// remote (http/https/etc) denies immediately, even if a URL field were
// somehow spoofed to match.
'use strict';

const ALLOWED_PERMISSIONS = new Set(['media', 'midi', 'midiSysex']);

const REMOTE_ORIGIN_RE = /^(https?|ftp|wss?):/i;

function parseFileUrl(candidate) {
  if (typeof candidate !== 'string' || candidate === '') {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') {
    return null;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = parsed.pathname;
  }
  return { host: parsed.host, pathname };
}

function isSameFile(candidate, appFileUrl) {
  const a = parseFileUrl(candidate);
  const b = parseFileUrl(appFileUrl);
  if (!a || !b) {
    return false;
  }
  return a.host === b.host && a.pathname === b.pathname;
}

// isAllowed decides whether ONE permission request should be granted.
//
// - permission: the string Electron passed ('media', 'midi', 'midiSysex', or
//   anything else, which is always denied).
// - requestingOrigin: setPermissionCheckHandler's third argument, if any.
//   Used only as a remote-origin veto (see module doc comment above).
// - requestingUrl: details.requestingUrl from either handler, if present.
// - webContentsUrl: webContents.getURL() at request time, if present.
// - appFileUrl: the app's own file:// URL (pathToFileURL(APP_HTML_PATH).href).
//
// Fails closed: any permission outside the allow-list, any missing/garbage
// input, or any candidate URL that does not resolve to the app's own file,
// denies the request.
function isAllowed({ permission, requestingOrigin, requestingUrl, webContentsUrl, appFileUrl } = {}) {
  if (typeof permission !== 'string' || !ALLOWED_PERMISSIONS.has(permission)) {
    return false;
  }
  if (typeof appFileUrl !== 'string' || parseFileUrl(appFileUrl) === null) {
    return false;
  }
  if (typeof requestingOrigin === 'string' && REMOTE_ORIGIN_RE.test(requestingOrigin)) {
    return false;
  }

  const candidates = [requestingUrl, webContentsUrl].filter(
    u => typeof u === 'string' && u !== ''
  );
  if (candidates.length === 0) {
    // Nothing provably identifies the requesting page's URL: fail closed
    // rather than trust an origin string alone.
    return false;
  }

  return candidates.every(u => isSameFile(u, appFileUrl));
}

module.exports = { isAllowed, ALLOWED_PERMISSIONS };
