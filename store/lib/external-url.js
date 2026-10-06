// Pure check for URLs the shell may hand to the OS (shell.openExternal).
//
// No Electron import on purpose: unit-tested with plain `node --test` in
// tests/unit/store-shell-hardening.test.mjs. openExternal passes the URL to
// the OS protocol handler, so a page-supplied `file:`, `javascript:`,
// `ms-msdt:`, `search-ms:` or any other registered scheme would run
// something on the machine. The app's own links (the update-check fallback
// and the website) are https, so https is the whole allow-list. Parsed with
// URL rather than prefix-matched; embedded credentials are refused because
// `https://trusted.example@evil.example/` reads as the wrong site.
'use strict';

function isSafeExternalUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname !== '' && parsed.username === '' && parsed.password === '';
}

module.exports = { isSafeExternalUrl };
