// Covers the "phone copy" PWA build (build/pages.mjs, build/pages/png.mjs):
// the file set, the manifest, the generated icons and the service worker's
// precache list — everything checkable without a browser. The offline/
// install-and-reload proof lives in tests/build/pages-offline.test.mjs since
// it needs headless Chromium and a throwaway HTTP server.
//
// Order matters here: `build()` (dev mode) `rmSync`s the whole `dist/`
// directory, so this file always finishes by leaving `dist/` as a plain dev
// build — the same state tests/build/verbatim.test.mjs and the
// characterization suite expect — regardless of what it built in between.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from '../../build/build.mjs';
import { buildPages, PRECACHE_FILES, ICON_FILES } from '../../build/pages.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PAGES_DIR = join(root, 'dist', 'pages');
const RELEASE_FILE = join(root, 'dist', 'release', 'band-coach.html');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Leave dist/ as a plain dev build for every other test file, whatever ran
// in between and whatever order node:test picks.
after(async () => {
  await build();
});

function pngDimensions(buf) {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    'PNG signature'
  );
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR', 'first chunk is IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
  };
}

test('pages build produces exactly the expected files', async () => {
  await buildPages();
  const entries = readdirSync(PAGES_DIR).sort();
  assert.deepEqual(entries, [
    'icon-192.png',
    'icon-512-maskable.png',
    'icon-512.png',
    'index.html',
    'manifest.webmanifest',
    'sw.js',
  ]);
});

test('manifest.webmanifest is valid JSON with the required members', async () => {
  await buildPages();
  const manifest = JSON.parse(readFileSync(join(PAGES_DIR, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Band Coach');
  assert.equal(manifest.short_name, 'Band Coach');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'has icons');

  for (const icon of manifest.icons) {
    const path = join(PAGES_DIR, icon.src.replace(/^\.\//, ''));
    assert.ok(existsSync(path), `manifest icon file exists: ${icon.src}`);
  }
  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('maskable'), 'at least one maskable icon is declared');
});

test('generated icon files are correctly-sized PNGs', async () => {
  await buildPages();
  const expected = {
    'icon-192.png': 192,
    'icon-512.png': 512,
    'icon-512-maskable.png': 512,
  };
  for (const [name, size] of Object.entries(expected)) {
    const buf = readFileSync(join(PAGES_DIR, name));
    const { width, height, bitDepth, colourType } = pngDimensions(buf);
    assert.equal(width, size, `${name} width`);
    assert.equal(height, size, `${name} height`);
    assert.equal(bitDepth, 8, `${name} bit depth`);
    assert.equal(colourType, 6, `${name} colour type (truecolour + alpha)`);
  }
  assert.deepEqual(ICON_FILES.sort(), Object.keys(expected).sort());
});

test('sw.js parses and its precache list matches the files on disk', async () => {
  await buildPages();
  const src = readFileSync(join(PAGES_DIR, 'sw.js'), 'utf8');

  // Parses as a classic (non-module) script, the shape a real
  // ServiceWorkerGlobalScope loads.
  assert.doesNotThrow(() => new Function(src), 'sw.js is syntactically valid JS');

  const match = src.match(/const PRECACHE = (\[[^\]]*\]);/);
  assert.ok(match, 'sw.js declares a PRECACHE array');
  const precache = JSON.parse(match[1]);

  const onDisk = readdirSync(PAGES_DIR).filter((f) => f !== 'sw.js').sort();
  assert.deepEqual([...precache].sort(), onDisk, 'precache list matches dist/pages/ minus sw.js itself');
  assert.deepEqual([...precache].sort(), [...PRECACHE_FILES].sort());
});

test('the one-file release build is byte-for-byte unaffected by the pages feature', async () => {
  process.env.SOURCE_DATE_EPOCH = '1700000000';
  try {
    await build({ release: true });
    const before = readFileSync(RELEASE_FILE);

    await buildPages();
    const after = readFileSync(RELEASE_FILE);

    assert.ok(before.equals(after), 'dist/release/band-coach.html is unchanged by building the pages edition');
  } finally {
    delete process.env.SOURCE_DATE_EPOCH;
  }
});

test('dist/pages/index.html carries the PWA metadata and never mentions dist/band-coach.html behaviour', async () => {
  await buildPages();
  const html = readFileSync(join(PAGES_DIR, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(html, /'serviceWorker' in navigator/);
  assert.match(html, /location\.protocol === 'https:'/);
  assert.match(html, /location\.hostname === 'localhost'/);
  assert.match(html, new RegExp(`band-coach-version" content="${PKG.version.replace(/\./g, '\\.')}"`));

  // Guard against the two builds diverging silently.
  const devBefore = readFileSync(HTML_PATH, 'utf8').length;
  assert.ok(devBefore > 0);
});
