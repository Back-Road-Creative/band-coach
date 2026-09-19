// Builds the "phone copy" edition: the exact same release build (see
// build.mjs) as a small installable web app, so it can be hosted for free on
// GitHub Pages from this repo. It never touches the one-file desktop
// download's behaviour — `dist/release/band-coach.html` is produced the same
// way it always was; this only adds files alongside it under `dist/pages/`:
//
//   index.html            the release build, plus a manifest link, a
//                         theme-color/apple-touch-icon meta/link, and a tiny
//                         inline service-worker registration script
//   manifest.webmanifest  installable-app metadata
//   sw.js                 cache-first app-shell service worker
//   icon-192.png, icon-512.png, icon-512-maskable.png
//                         generated at build time by build/pages/png.mjs —
//                         no binary asset is committed, no dependency added
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
// Every file the service worker precaches, and every file `buildPages`
// writes into `dist/pages/` besides `sw.js` itself — kept as one list so a
// test can assert the two never drift apart.
export const PRECACHE_FILES = ['index.html', 'manifest.webmanifest', ...ICON_FILES];
export const CACHE_PREFIX = 'band-coach-pages-v';

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
  if (!releaseHtml.includes('</head>')) {
    throw new Error('release build is missing </head>; cannot inject PWA metadata');
  }
  let html = releaseHtml.replace('</head>', headAdditions + '</head>');

  // Guarded so this never throws in an insecure context (plain http on a
  // non-loopback host) or a browser with no Service Worker support at all.
  const swRegistration =
    '<script>' +
    "if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {" +
    "window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js'); });" +
    '}' +
    '</script>';
  if (!html.includes('</body>')) {
    throw new Error('release build is missing </body>; cannot inject the service-worker registration');
  }
  html = html.replace('</body>', swRegistration + '</body>');
  return html;
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
  const pagesHtml = injectPwaHead(releaseHtml);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'index.html'), pagesHtml, 'utf8');
  writeFileSync(join(outDir, 'manifest.webmanifest'), JSON.stringify(buildManifest(), null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'sw.js'), buildServiceWorkerSource(version), 'utf8');
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
export async function buildPages({ outDir } = {}) {
  const { build } = await import('./build.mjs');
  const releaseFile = await build({ release: true });
  const releaseHtml = readFileSync(releaseFile, 'utf8');
  return writePagesFiles({ releaseHtml, version: PKG.version, outDir });
}

export { PAGES_DIR };
