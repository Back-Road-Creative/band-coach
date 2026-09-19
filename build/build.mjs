// Bundles src/app.js (no external deps, so this is really just running it
// through esbuild for a consistent, minify-free IIFE wrap) and inlines it
// plus src/styles.css into the src/index.html shell, writing the result as
// the single self-contained dist/band-coach.html the app has always shipped
// as. No minification: the output should stay readable and diffable against
// the pre-refactor file.
//
// `--release` (or `build({ release: true })`) instead produces the file a
// learner actually downloads, `dist/release/band-coach.html`: minified JS,
// the `window.__coach` debug hook compiled out entirely (via esbuild's
// `define`, so the minifier can dead-code-eliminate it), and the version +
// build date stamped into a meta tag and the page footer. The plain dev
// build used by the test suite is unaffected by any of that.
import { build as esbuildBuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const SRC_JS = join(root, 'src', 'app.js');
const SRC_CSS = join(root, 'src', 'styles.css');
const SRC_HTML = join(root, 'src', 'index.html');
const OUT_DIR = join(root, 'dist');
const OUT_FILE = join(OUT_DIR, 'band-coach.html');
const RELEASE_DIR = join(OUT_DIR, 'release');
const RELEASE_FILE = join(RELEASE_DIR, 'band-coach.html');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const CSS_PLACEHOLDER = '/*__BAND_COACH_CSS__*/';
const JS_PLACEHOLDER = '/*__BAND_COACH_JS__*/';
const VERSION_META_PLACEHOLDER = '<meta name="band-coach-version" content="">';
const VERSION_FOOTER_PLACEHOLDER = '<footer id="verFooter" aria-hidden="true"></footer>';

// UTC YYYY-MM-DD. Honours SOURCE_DATE_EPOCH (seconds since epoch) so tests
// can pin the build date instead of depending on wall-clock time.
function buildDate() {
  const epochSeconds = process.env.SOURCE_DATE_EPOCH;
  const ms = epochSeconds ? Number(epochSeconds) * 1000 : Date.now();
  return new Date(ms).toISOString().slice(0, 10);
}

export async function build({ release = false } = {}) {
  const result = await esbuildBuild({
    entryPoints: [SRC_JS],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: release,
    sourcemap: false,
    write: false,
    define: { __DEBUG_HOOK__: release ? 'false' : 'true' },
  });

  const [out] = result.outputFiles;
  if (!out) {
    throw new Error('esbuild produced no output for ' + SRC_JS);
  }
  // A literal "</script" inside the bundled JS would close the wrapping tag
  // early when the browser parses the built HTML file.
  const js = out.text.replace(/<\/script/gi, '<\\/script');
  const css = readFileSync(SRC_CSS, 'utf8');
  const shell = readFileSync(SRC_HTML, 'utf8');

  if (!shell.includes(CSS_PLACEHOLDER)) {
    throw new Error('src/index.html is missing the CSS placeholder ' + CSS_PLACEHOLDER);
  }
  if (!shell.includes(JS_PLACEHOLDER)) {
    throw new Error('src/index.html is missing the JS placeholder ' + JS_PLACEHOLDER);
  }

  let html = shell
    .replace(CSS_PLACEHOLDER, () => css)
    .replace(JS_PLACEHOLDER, () => js);

  if (release) {
    const date = buildDate();
    if (!html.includes(VERSION_META_PLACEHOLDER)) {
      throw new Error('src/index.html is missing the version meta placeholder');
    }
    if (!html.includes(VERSION_FOOTER_PLACEHOLDER)) {
      throw new Error('src/index.html is missing the version footer placeholder');
    }
    html = html
      .replace(VERSION_META_PLACEHOLDER, `<meta name="band-coach-version" content="${PKG.version}">`)
      .replace(VERSION_FOOTER_PLACEHOLDER, `<footer id="verFooter" aria-hidden="true">Band Coach v${PKG.version} · built ${date}</footer>`);

    mkdirSync(RELEASE_DIR, { recursive: true });
    writeFileSync(RELEASE_FILE, html, 'utf8');
    return RELEASE_FILE;
  }

  // A clean dev build so a stray dist/release/ from an earlier `--release`
  // run never leaks into the "dist/ has exactly one file" build tests.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, html, 'utf8');
  return OUT_FILE;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const release = process.argv.includes('--release');
  try {
    const outFile = await build({ release });
    console.log('built ' + outFile);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
