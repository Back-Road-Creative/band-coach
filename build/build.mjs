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

// `outDir` defaults to `dist/` — the real build output. It is a parameter
// because a DEV build starts by deleting the whole directory (see the rmSync
// below), and node:test runs test FILES concurrently: one file's dev build
// would wipe `dist/release/band-coach.html` out from under another file that
// is reading or serving it. Any caller that is not the real build passes its
// own throwaway directory, so no two builds can collide by construction.
// One source of truth for how the app is bundled. `bundleStats()` below
// measures with these EXACT options, so a size budget can never drift away
// from the build it claims to be measuring.
function esbuildOptions(release) {
  return {
    entryPoints: [SRC_JS],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: release,
    sourcemap: false,
    write: false,
    define: { __DEBUG_HOOK__: release ? 'false' : 'true' },
  };
}

// How many bytes each source module contributes to the bundle, from esbuild's
// own metafile. This is what a per-module budget has to measure: the size of
// the built FILE minus a historical baseline charges every unrelated change
// since that baseline to whichever module the budget happens to name.
export async function bundleStats({ release = false } = {}) {
  const result = await esbuildBuild({ ...esbuildOptions(release), metafile: true });
  const [output] = Object.values(result.metafile.outputs);
  return output.inputs;
}

// Bytes contributed by one source file, keyed as esbuild keys it (a path
// relative to the working directory, e.g. `src/audio/voices.js`). Throws
// rather than returning 0 for an unknown path, so a budget cannot silently
// pass because the module was renamed out from under it.
export async function moduleBytes(relPath, { release = false } = {}) {
  const inputs = await bundleStats({ release });
  const hit = Object.entries(inputs).find(([key]) => key === relPath || key.endsWith('/' + relPath));
  if (!hit) {
    throw new Error(`${relPath} is not in the bundle; known inputs: ${Object.keys(inputs).join(', ')}`);
  }
  return hit[1].bytesInOutput;
}

// The directory a module's bytes roll up under: `src/audio/voices.js` rolls up
// to `src/audio`, but a file living directly in `src/` (there is exactly one,
// `src/app.js` itself -- the entry point's own dense IIFE body) rolls up to
// `src` rather than to itself, since a per-FILE bucket would defeat the point
// of a directory-level rollup.
function rollupDirectory(relPath) {
  const parts = relPath.split('/');
  return parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0];
}

// Turns esbuild's metafile inputs into something a human (or a failing test)
// can read at a glance: every module's contribution, sorted biggest-first so
// the worst offender is always first, plus a rollup by top-level directory
// (src/ui, src/core, src/song, ...) so "where did the bytes go" has an answer
// one level up from 127 individual files. `byDirectory` sums to `total` by
// construction -- it is built from the exact same per-module numbers that
// `modules` reports, never a separate measurement that could drift.
export async function bundleBreakdown({ release = false } = {}) {
  const inputs = await bundleStats({ release });
  const modules = Object.entries(inputs)
    .map(([path, info]) => ({ path, bytes: info.bytesInOutput }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = modules.reduce((sum, m) => sum + m.bytes, 0);
  const byDirectory = {};
  for (const m of modules) {
    const dir = rollupDirectory(m.path);
    byDirectory[dir] = (byDirectory[dir] || 0) + m.bytes;
  }
  return { modules, total, byDirectory };
}

export async function build({ release = false, outDir = OUT_DIR } = {}) {
  const outFile = join(outDir, 'band-coach.html');
  const releaseDir = join(outDir, 'release');
  const releaseFile = join(releaseDir, 'band-coach.html');
  const result = await esbuildBuild(esbuildOptions(release));

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

    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(releaseFile, html, 'utf8');
    return releaseFile;
  }

  // A clean dev build so a stray dist/release/ from an earlier `--release`
  // run never leaks into the "dist/ has exactly one file" build tests.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, html, 'utf8');
  return outFile;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const release = process.argv.includes('--release');
  const pages = process.argv.includes('--pages');
  try {
    if (pages) {
      // Build the release file ourselves and hand pages.mjs the finished
      // HTML, rather than letting it import `build` from this module: this
      // module is mid-evaluation of its own top-level await right now (we
      // are inside it), and a static import cycle back into an unsettled
      // top-level-await module is a hard Node error, not just a warning.
      const releaseFile = await build({ release: true });
      const releaseHtml = readFileSync(releaseFile, 'utf8');
      const { writePagesFiles } = await import('./pages.mjs');
      const outDir = await writePagesFiles({ releaseHtml, version: PKG.version });
      console.log('built ' + outDir);
    } else {
      const outFile = await build({ release });
      console.log('built ' + outFile);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
