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
// build date stamped into a meta tag and the page footer. The build date is
// the date of the commit being built (see `resolveBuildDate`), so two release
// builds of one commit -- the staged file and the published one -- are one
// file whatever day each ran. The plain dev build used by the test suite is
// unaffected by any of that and never asks git.
import { build as esbuildBuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

// The release footer's UTC YYYY-MM-DD, resolved in this order:
//   a. SOURCE_DATE_EPOCH (seconds since epoch) when set and non-empty, so a
//      caller or a test can pin it;
//   b. otherwise the committer time of HEAD (`%ct`, not the author time: a
//      rebase or merge-forward keeps the author date but makes a new commit),
//      only when `root` is itself the top of a git work tree, so a copy of this
//      tree inside some other repo never takes that repo's date;
//   c. otherwise the wall clock, with a reason the caller prints.
// Never throws on a git problem; a non-numeric SOURCE_DATE_EPOCH still throws
// the RangeError from toISOString, as it always has.
// A guess, not a measurement: it only has to be longer than a healthy `git log -1`.
const GIT_LOOKUP_TIMEOUT_MS = 10000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function resolveBuildDate({ env = process.env, root, run = spawnSync, now = Date.now }) {
  const epochSeconds = env.SOURCE_DATE_EPOCH;
  if (epochSeconds) return { date: isoDay(Number(epochSeconds) * 1000), source: 'SOURCE_DATE_EPOCH' };
  const wall = (reason) => ({ date: isoDay(now()), source: 'wall-clock', reason });
  // git honours GIT_DIR, GIT_WORK_TREE and friends over its own discovery, so none of them reach it.
  const gitEnv = {};
  for (const k of Object.keys(env)) if (!k.toUpperCase().startsWith('GIT_')) gitEnv[k] = env[k];
  // Runs git; returns { out } on success or { why } (a one-line reason) on any failure.
  const git = (args) => {
    let r;
    try {
      r = run('git', args, { cwd: root, env: gitEnv, encoding: 'utf8', timeout: GIT_LOOKUP_TIMEOUT_MS });
    } catch (err) {
      return { why: 'git failed (' + (err && err.message) + ')' };
    }
    if (r.error) return { why: r.error.code === 'ENOENT' ? 'git is missing from this machine' : 'git failed (' + (r.error.code || r.error.message) + ')' };
    if (r.status !== 0) {
      const firstLine = String(r.stderr || '').split(/\r?\n/).find((l) => l.trim());
      return { why: 'git failed (' + (r.status === null ? 'signal ' + r.signal : 'exit ' + r.status) + (firstLine ? ': ' + firstLine.trim() : '') + ')' };
    }
    return { out: String(r.stdout || '').trim() };
  };
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.why) return wall(top.why);
  // `resolve('')` is the cwd, so an empty answer would pass the comparison below without git naming a toplevel.
  if (!top.out) return wall('not the top of a git work tree (git named no toplevel)');
  try {
    const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (!same(realpathSync(resolve(top.out)), realpathSync(resolve(root)))) return wall('not the top of a git work tree');
  } catch (err) {
    return wall('not the top of a git work tree (could not compare paths: ' + err.code + ')');
  }
  const log = git(['-c', 'log.showSignature=false', 'log', '-1', '--format=%ct']);
  if (log.why) return wall(log.why);
  if (!/^\d+$/.test(log.out)) return wall('git output was not a number');
  return { date: isoDay(Number(log.out) * 1000), source: 'commit' };
}

function buildDate() {
  const r = resolveBuildDate({ root });
  if (r.source === 'wall-clock') console.error('build date: fell back to the wall clock (' + r.reason + '); this build is not reproducible across days');
  return r.date;
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
  // The stylesheet's comments are notes for whoever edits it; they never reach the built page
  // (about 15KB of every download). No string in styles.css contains "/*" (verbatim.test.mjs).
  const css = readFileSync(SRC_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n');
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
