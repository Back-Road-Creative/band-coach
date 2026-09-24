// Copies the built one-file app into store/app/band-coach.html so
// electron-builder's `files` list (a plain relative glob) can find it.
//
// build/build.mjs writes either ../dist/release/band-coach.html (a --release
// build: minified, debug hook off, version footer filled) or the plain
// ../dist/band-coach.html. The release file wins when both exist. With
// --require-release (what dist:appx:submission passes) the plain file is
// refused: a Store package built from it ships the dev HTML with an empty
// version footer, and nothing downstream inspects the packaged HTML.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const storeRoot = dirname(here);
const repoRoot = dirname(storeRoot);

const RELEASE_HTML = join(repoRoot, 'dist', 'release', 'band-coach.html');
const PLAIN_HTML = join(repoRoot, 'dist', 'band-coach.html');
const APP_DIR = join(storeRoot, 'app');
const OUT_HTML = join(APP_DIR, 'band-coach.html');

export function resolveSourceHtml({
  requireRelease = false,
  releaseHtml = RELEASE_HTML,
  plainHtml = PLAIN_HTML,
} = {}) {
  if (existsSync(releaseHtml)) {
    return releaseHtml;
  }
  if (requireRelease) {
    throw new Error(
      releaseHtml + ' does not exist and --require-release refuses the plain build. ' +
        'Run `npm run build -- --release` at the repo root first.'
    );
  }
  if (existsSync(plainHtml)) {
    return plainHtml;
  }
  throw new Error(
    'Neither ' + releaseHtml + ' nor ' + plainHtml + ' exists. ' +
      'Run the root build (npm run build, optionally --release) first.'
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const src = resolveSourceHtml({ requireRelease: process.argv.includes('--require-release') });
  mkdirSync(APP_DIR, { recursive: true });
  copyFileSync(src, OUT_HTML);
  console.log('staged ' + src + ' -> ' + OUT_HTML);
}
