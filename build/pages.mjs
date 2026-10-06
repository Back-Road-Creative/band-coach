// Builds the "phone copy" edition: the exact same release build (see
// build.mjs) as a small installable web app, so it can be hosted for free on
// GitHub Pages from this repo. It never touches the one-file desktop
// download's behaviour — `dist/release/band-coach.html` is produced the same
// way it always was; this only adds files alongside it under `dist/pages/`:
//
//   index.html            the release build, plus a manifest link, a
//                         theme-color/apple-touch-icon meta/link, a tiny
//                         inline service-worker registration script, and a
//                         strict hash-based Content-Security-Policy <meta>
//                         (the one-file download has none; see injectCsp)
//   manifest.webmanifest  installable-app metadata
//   sw.js                 cache-first app-shell service worker
//   icon-192.png, icon-512.png, icon-512-maskable.png
//                         generated at build time by build/pages/png.mjs —
//                         no binary asset is committed, no dependency added
//   version.json          the current version, release date and download
//                         URL, so a downloaded band-coach.html — which can
//                         never auto-update itself — can ask whether it's
//                         stale. Deliberately NOT precached by sw.js.
//
// Nothing here is cross-origin: the release build is one self-contained
// file with zero network requests, so the app shell has nothing to fetch
// beyond the files listed above.
// Deliberately does NOT import `build` from './build.mjs' at the top level.
// build.mjs's CLI entry point calls this module's `writePagesFiles` after
// building the release file itself — a static import cycle back into
// build.mjs while ITS top-level await is still unsettled (i.e. while running
// as `node build/build.mjs --pages`) is a hard Node error, not just a
// warning. `buildPages` below, for standalone/test use, imports build.mjs
// dynamically instead, which only ever happens from a caller other than
// build.mjs's own CLI entry, so there is nothing mid-evaluation to cycle
// back into.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodePng } from './pages/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const PAGES_DIR = join(root, 'dist', 'pages');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const THEME_COLOR = '#2563eb';
const BACKGROUND_COLOR = '#ffffff';

export const ICON_FILES = ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];
// Every file the service worker precaches — kept as its own list so a test
// can assert it matches sw.js's runtime PRECACHE array exactly.
export const PRECACHE_FILES = ['index.html', 'manifest.webmanifest', ...ICON_FILES];
// Written into `dist/pages/` alongside the precached files, but deliberately
// NOT precached: version.json exists so a downloaded band-coach.html (which
// can never auto-update itself) can ask whether it's stale. If the service
// worker cached it, a stale copy would just be told its own stale version is
// current, defeating the file's entire purpose.
export const WRITTEN_NOT_PRECACHED_FILES = ['version.json'];
// Every file `buildPages` writes into `dist/pages/` besides `sw.js` itself —
// PRECACHE_FILES plus WRITTEN_NOT_PRECACHED_FILES — kept as one list so a
// test can assert the file set on disk never drifts from what this module
// claims to write.
export const WRITTEN_FILES = [...PRECACHE_FILES, ...WRITTEN_NOT_PRECACHED_FILES];
export const CACHE_PREFIX = 'band-coach-pages-v';
export const DOWNLOAD_URL = 'https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html';

function drawIcon(size, { maskable }) {
  const bg = [0x25, 0x63, 0xeb, 0xff]; // theme blue, opaque
  const fg = [0xff, 0xff, 0xff, 0xff]; // white
  const cx = size / 2;
  const cy = size / 2;
  // A maskable icon can be cropped to a circle/squircle by the OS, so its
  // meaningful content has to sit inside a safe zone (~80% of the square,
  // i.e. radius <= 0.4 * size around the centre) — keep the shape smaller
  // still, at 0.3 * size, to be safe about that crop.
  const radius = size * (maskable ? 0.3 : 0.36);
  return encodePng(size, size, (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    return Math.sqrt(dx * dx + dy * dy) <= radius ? fg : bg;
  });
}

export function buildManifest() {
  return {
    name: 'Band Coach',
    short_name: 'Band Coach',
    description: PKG.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: './icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export function buildServiceWorkerSource(version) {
  return `// Generated at build time by build/pages.mjs. Do not edit by hand.
// Cache-first app shell: everything this app needs is precached below and
// nothing here is ever fetched cross-origin (the app itself makes zero
// network requests, release build or not).
const CACHE_NAME = ${JSON.stringify(CACHE_PREFIX + version)};
const PRECACHE = ${JSON.stringify(PRECACHE_FILES)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(${JSON.stringify(CACHE_PREFIX)}) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never handle cross-origin
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  let rel = url.pathname.slice(scope.pathname.length);
  if (rel === '') rel = 'index.html'; // the app's start_url, "./"
  if (!PRECACHE.includes(rel)) return; // nothing else is ours to serve
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(rel).then((cached) => cached || fetch(event.request)))
  );
});
`;
}

function injectPwaHead(releaseHtml) {
  const headAdditions =
    '<link rel="manifest" href="./manifest.webmanifest">' +
    `<meta name="theme-color" content="${THEME_COLOR}">` +
    '<link rel="apple-touch-icon" href="./icon-192.png">';
  // The document's own </head> is the FIRST one: the release file keeps every
  // script in the <body>, and the bundle builds a whole report document as a
  // string ('<html><head>...</head><body>'), so the LAST </head> -- even one
  // with a <body after it -- can be inside the script.
  let html = insertBeforeOwnHeadEnd(releaseHtml, headAdditions);

  // Guarded so this never throws in an insecure context (plain http on a
  // non-loopback host) or a browser with no Service Worker support at all.
  const swRegistration =
    '<script>' +
    "if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {" +
    "window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js'); });" +
    '}' +
    '</script>';
  // The document's own </body> has nothing after it but </html>.
  html = insertBeforeLast(html, '</body>', swRegistration, (tail) => tail.replace(/<\/html>/i, '').trim() === '');
  return html;
}

// The hosted copy's Content-Security-Policy, as a <meta> (GitHub Pages cannot
// set headers). Only the hosted copy gets one: under file:// the pitch worklet
// can only load from a data: URL, and data: in script-src would let an
// injected <script src="data:..."> run -- the very thing this policy exists to
// stop. Here the worklet loads from a blob: URL instead (createPitchNode).
//   - script-src: the sha256 of every inline <script> (the bundle and the
//     service-worker registration) plus blob: for the worklet. No
//     'unsafe-inline', no 'unsafe-eval', no data:, so injected markup cannot
//     become running code.
//   - style-src-elem: the hash of the inline <style>. style-src-attr allows
//     'unsafe-inline' only because the UI sets style="..." attributes, and a
//     style attribute cannot run script.
//   - img-src: the app itself draws no <img>/CSS images (everything is inline
//     SVG or canvas); 'self' covers only the manifest and apple-touch icons.
//   - connect-src: the update check and the optional model pack fetch from the
//     project's own Pages origin (src/core/update-check.js, model-pack.js). A
//     model pack's manifest `url` must therefore live on that same origin: a
//     pack file hosted anywhere else would be refused on this copy.
//   - worker-src: only the service worker (./sw.js, same origin). The pitch
//     worklet is not a Worker; addModule is governed by script-src, which is
//     why blob: lives there and not here (measured: no violation without it).
//   - frame-ancestors is ignored inside a <meta>, so it is left out.
function cspMeta(html) {
  const hashes = { script: [], style: [] };
  for (const m of html.matchAll(/<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    if (/\ssrc\s*=/i.test(m[2] || '')) continue;
    hashes[m[1].toLowerCase()].push(`'sha256-${createHash('sha256').update(m[3], 'utf8').digest('base64')}'`);
  }
  const policy = [
    "default-src 'none'",
    `script-src ${[...hashes.script, 'blob:'].join(' ')}`,
    `style-src-elem ${hashes.style.join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "connect-src 'self' https://back-road-creative.github.io",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

// Goes straight after the document's own charset meta (which has to stay in
// the first 1024 bytes), so it precedes every inline script and style. The
// hashes are of the final bytes: the policy meta is neither a script nor a
// style, so adding it cannot change them.
function injectCsp(html) {
  const head = /<head>(<meta charset="utf-8">)?/i.exec(html);
  if (!head) throw new Error('release build has no <head>; cannot inject the Content-Security-Policy');
  const at = head.index + head[0].length;
  return html.slice(0, at) + cspMeta(html) + html.slice(at);
}

// The release file is ONE file with the whole app inlined, so `</head>` and
// `</body>` also occur inside the JavaScript (a panel that builds an HTML
// string). The document's own </body> is the LAST one, with only </html> after
// it. Its own </head> is the FIRST one, with no script before it.
function insertBeforeOwnHeadEnd(html, addition) {
  const at = html.indexOf('</head>');
  if (at === -1) throw new Error('release build is missing </head>; cannot inject the phone-copy additions');
  if (/<script[\s>]/i.test(html.slice(0, at))) {
    throw new Error('a <script> comes before the first </head>; refusing to guess which </head> is the document\'s own');
  }
  return html.slice(0, at) + addition + html.slice(at);
}

function insertBeforeLast(html, tag, addition, tailIsRight) {
  const at = html.lastIndexOf(tag);
  if (at === -1) throw new Error(`release build is missing ${tag}; cannot inject the phone-copy additions`);
  const tail = html.slice(at + tag.length);
  if (!tailIsRight(tail)) {
    throw new Error(`the last ${tag} is not the document's own; refusing to inject into the wrong place`);
  }
  return html.slice(0, at) + addition + html.slice(at);
}

/**
 * Pure write step: given an already-built release HTML string and the
 * version it was stamped with, writes the phone-copy directory (index.html,
 * manifest, service worker, icons) and returns it. Does not build anything
 * itself, so it has no dependency on build.mjs.
 *
 * `outDir` defaults to `dist/pages/` — the directory the Pages workflow
 * publishes. It is a parameter because this function starts by DELETING the
 * directory: two callers sharing `dist/pages/` at once means one of them is
 * serving or reading files while the other wipes them. Any caller that is not
 * the real build (a test, in particular) passes its own throwaway directory,
 * so no two can ever collide by construction.
 */
export async function writePagesFiles({ releaseHtml, version, outDir = PAGES_DIR }) {
  const pagesHtml = injectCsp(injectPwaHead(releaseHtml));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'index.html'), pagesHtml, 'utf8');
  writeFileSync(join(outDir, 'manifest.webmanifest'), JSON.stringify(buildManifest(), null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'sw.js'), buildServiceWorkerSource(version), 'utf8');
  writeFileSync(
    join(outDir, 'version.json'),
    JSON.stringify(
      { version, released: new Date().toISOString(), download: DOWNLOAD_URL },
      null,
      2
    ) + '\n',
    'utf8'
  );
  for (const { name, size, maskable } of [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'icon-512-maskable.png', size: 512, maskable: true },
  ]) {
    writeFileSync(join(outDir, name), drawIcon(size, { maskable }));
  }

  return outDir;
}

/**
 * Convenience wrapper for standalone/test callers: builds the release file
 * itself (dynamically importing build.mjs) and then writes `dist/pages/`.
 * Never called from build.mjs's own CLI entry point — see the note above.
 */
// `buildDir` is forwarded to build() as ITS output directory — a caller that
// passes its own `outDir` almost always wants its own build directory too,
// or it is still sharing `dist/release/` with every other concurrent build.
export async function buildPages({ outDir, buildDir } = {}) {
  const { build } = await import('./build.mjs');
  const releaseFile = await build({ release: true, outDir: buildDir });
  const releaseHtml = readFileSync(releaseFile, 'utf8');
  return writePagesFiles({ releaseHtml, version: PKG.version, outDir });
}

export { PAGES_DIR };
