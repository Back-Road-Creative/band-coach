// Copies the built one-file app into store/app/band-coach.html so
// electron-builder's `files` list (a plain relative glob) can find it.
//
// The build/build.mjs another agent is extending concurrently may write
// either ../dist/release/band-coach.html (a --release build) or the plain
// ../dist/band-coach.html — this checks the release path first and falls
// back to the plain one, so this script works whichever lands first.
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

export function resolveSourceHtml() {
  if (existsSync(RELEASE_HTML)) {
    return RELEASE_HTML;
  }
  if (existsSync(PLAIN_HTML)) {
    return PLAIN_HTML;
  }
  throw new Error(
    'Neither ' + RELEASE_HTML + ' nor ' + PLAIN_HTML + ' exists. ' +
      'Run the root build (npm run build, optionally --release) first.'
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const src = resolveSourceHtml();
  mkdirSync(APP_DIR, { recursive: true });
  copyFileSync(src, OUT_HTML);
  console.log('staged ' + src + ' -> ' + OUT_HTML);
}
