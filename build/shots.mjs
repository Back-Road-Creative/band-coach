// Writes a desktop and a phone PNG of the already-built app to dist/, so a
// UI change can be looked at by the repo, by CI and by a future session
// instead of only by a human pasting an ad hoc shell command. This never
// builds anything itself -- it opens `dist/band-coach.html` exactly as the
// test suite does (see tests/helpers/html-path.mjs), so `npm run build` must
// have already run. Kept a separate step, not folded into `build`, because
// the two answer different questions: `build` asks "does the app still
// bundle", `shots` asks "what does it look like" -- forcing every build to
// also boot a browser would slow the common case for a check most builds
// don't need.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launchPage } from '../tests/helpers/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const HTML_PATH = join(root, 'dist', 'band-coach.html');
const OUT_DIR = join(root, 'dist');

// A laptop-width desktop layout (above the 1080px `.wrap` max-width AND the
// 860px single-column breakpoint in src/styles.css, so the real multi-column
// desktop layout is what gets captured) and a real phone's logical size
// (390x844, an iPhone 12/13/14 -- comfortably under the 480px/400px
// small-screen breakpoints), rather than arbitrary round numbers, so each
// shot exercises a layout mode the app actually switches into.
export const SHOTS = [
  { name: 'screenshot-desktop.png', width: 1440, height: 900, mobile: false },
  { name: 'screenshot-phone.png', width: 390, height: 844, mobile: true },
];

/**
 * Captures every entry in SHOTS from the built app and writes each PNG into
 * `outDir` (defaults to dist/, the real output). Returns the list of paths
 * written. `outDir` is a parameter for the same reason build()'s is -- a
 * test that ran this should never fight the real `npm run shots` (or another
 * test) over dist/ paths.
 */
export async function captureShots({ htmlPath = HTML_PATH, outDir = OUT_DIR } = {}) {
  if (!existsSync(htmlPath)) {
    throw new Error(`${htmlPath} does not exist -- run "npm run build" first`);
  }
  const page = await launchPage(htmlPath);
  const written = [];
  try {
    for (const { name, width, height, mobile } of SHOTS) {
      await page.setViewport({ width, height, mobile });
      const outPath = join(outDir, name);
      await page.screenshot(outPath);
      written.push(outPath);
    }
  } finally {
    await page.close();
  }
  return written;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const written = await captureShots();
  for (const path of written) console.log(`wrote ${path}`);
}
