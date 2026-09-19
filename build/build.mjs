// Bundles src/app.js (no external deps, so this is really just running it
// through esbuild for a consistent, minify-free IIFE wrap) and inlines it
// plus src/styles.css into the src/index.html shell, writing the result as
// the single self-contained dist/band-coach.html the app has always shipped
// as. No minification: the output should stay readable and diffable against
// the pre-refactor file.
import { build as esbuildBuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const SRC_JS = join(root, 'src', 'app.js');
const SRC_CSS = join(root, 'src', 'styles.css');
const SRC_HTML = join(root, 'src', 'index.html');
const OUT_DIR = join(root, 'dist');
const OUT_FILE = join(OUT_DIR, 'band-coach.html');

const CSS_PLACEHOLDER = '/*__BAND_COACH_CSS__*/';
const JS_PLACEHOLDER = '/*__BAND_COACH_JS__*/';

export async function build() {
  const result = await esbuildBuild({
    entryPoints: [SRC_JS],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    write: false,
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

  const html = shell
    .replace(CSS_PLACEHOLDER, () => css)
    .replace(JS_PLACEHOLDER, () => js);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, html, 'utf8');
  return OUT_FILE;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const outFile = await build();
    console.log('built ' + outFile);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
