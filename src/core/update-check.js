// A downloaded band-coach.html runs from file:// and cannot write to disk,
// replace itself, or auto-update -- that is a browser security boundary,
// not a missing feature. What it CAN do, on request, is ask the published
// version.json (served from GitHub Pages with an open CORS policy, so a
// file:// page's Origin: null is allowed through) whether it is current,
// and hand the user a one-click link if it isn't. This module is the pure
// seam: version comparison and the fetch policy, no DOM, no global fetch
// reference of its own -- app.js supplies fetchImpl (or `undefined` when
// the browser has none), so every branch is provable without a browser and
// this module never assumes a capability it hasn't been handed.
import { DEV_VERSION } from './version.js';

// Published by a sibling build step (not this file, not build/pages.mjs's
// concern here) at this fixed URL, shaped
// { "version": "1.3.0", "released": "<ISO date>", "download": "<url>" }.
export const VERSION_CHECK_URL = 'https://back-road-creative.github.io/band-coach/version.json';

// Used both when version.json's own "download" field is missing/malformed
// AND whenever the check itself failed and there is nothing else to point
// the "behind" link at.
//
// This MUST be the release asset, not the web app: the person reading that
// link has a downloaded file in front of them and pressed a button labelled
// "check for updates", so sending them to the hosted version answers a
// question they did not ask. GitHub resolves "latest" at request time, so
// this URL cannot go stale the way a version-pinned one would -- it is the
// same URL the site's own download link uses.
export const FALLBACK_DOWNLOAD_URL =
  'https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html';

// ~5s: long enough for a slow connection, short enough that a learner who
// pressed the button gets an answer instead of a spinner that never ends.
export const CHECK_TIMEOUT_MS = 5000;

// Reads a leading MAJOR.MINOR.PATCH triple. Anything that doesn't start
// with three dot-separated integers is treated as unparseable rather than
// guessed at -- an unparseable version must never silently compare as
// "older" (a bare string compare's failure mode) or crash the check.
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Numeric, per-component comparison -- never a string compare, which gets
// "1.10.0" vs "1.9.0" backwards. Returns -1/0/1, or null when either side
// fails to parse, so a caller can never mistake "don't know" for "older".
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// Resolves to exactly one of:
//   { status: 'dev' }                                     -- no request made
//   { status: 'up-to-date', latestVersion }
//   { status: 'behind', latestVersion, downloadUrl }
//   { status: 'error', downloadUrl }                       -- "couldn't reach"
// NEVER throws and NEVER leaves a rejected promise: every failure mode
// (missing fetch, offline, DNS blocked, a proxy, a non-200, malformed JSON,
// a missing/unparseable version field, or the request outliving timeoutMs)
// funnels into the same 'error' shape, because to the learner they are all
// the same answer -- "couldn't check right now" -- and the button still
// hands them a way to get the current file.
export async function checkForUpdate(opts = {}) {
  const {
    currentVersion,
    fetchImpl,
    timeoutMs = CHECK_TIMEOUT_MS,
    versionUrl = VERSION_CHECK_URL,
    fallbackDownloadUrl = FALLBACK_DOWNLOAD_URL,
  } = opts;

  // A dev build (unbuilt page, or a missing build-time version stamp) has
  // nothing meaningful to compare against a release number, so it is its
  // own state and makes no request at all -- see design rule 6.
  if (currentVersion === DEV_VERSION) return { status: 'dev' };

  if (typeof fetchImpl !== 'function') return { status: 'error', downloadUrl: fallbackDownloadUrl };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(versionUrl, controller ? { signal: controller.signal } : undefined);
    if (!res || !res.ok) return { status: 'error', downloadUrl: fallbackDownloadUrl };
    const data = await res.json();
    const latest = data && typeof data.version === 'string' ? data.version : null;
    if (!latest) return { status: 'error', downloadUrl: fallbackDownloadUrl };
    const downloadUrl = (data && typeof data.download === 'string' && data.download) || fallbackDownloadUrl;
    const cmp = compareVersions(currentVersion, latest);
    if (cmp === null) return { status: 'error', downloadUrl: fallbackDownloadUrl };
    if (cmp >= 0) return { status: 'up-to-date', latestVersion: latest };
    return { status: 'behind', latestVersion: latest, downloadUrl };
  } catch (e) {
    return { status: 'error', downloadUrl: fallbackDownloadUrl };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
