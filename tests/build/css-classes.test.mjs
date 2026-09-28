// Two whole-repo consistency checks between src/styles.css and the JS that
// builds the DOM, so a class renamed on one side and not the other (like the
// panel-learn-*/panel-songs-* mismatch this test file was added to catch)
// fails the suite instead of shipping unstyled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const srcDir = path.join(repoRoot, 'src');

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function stripJsComments(src) {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const jsFiles = walk(srcDir, ['.js']);
const indexHtmlPath = path.join(srcDir, 'index.html');
const allSrcText = jsFiles
  .map((f) => stripJsComments(fs.readFileSync(f, 'utf8')))
  .concat(fs.existsSync(indexHtmlPath) ? [fs.readFileSync(indexHtmlPath, 'utf8')] : [])
  .join('\n');

const recordDoorPath = path.join(srcDir, 'ui', 'songs', 'record-door.js');
const recordDoorSrc = stripJsComments(fs.readFileSync(recordDoorPath, 'utf8'));

function panelSongsClassLiterals(src) {
  const found = new Set();
  const re = /panel-songs-[\w-]+/g;
  let m;
  while ((m = re.exec(src))) found.add(m[0]);
  return found;
}

const cssPath = path.join(srcDir, 'styles.css');
const cssRaw = fs.readFileSync(cssPath, 'utf8');
const cssNoComments = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const cssSelectorsOnly = cssNoComments.replace(/\{[^{}]*\}/g, '{}');

function cssClassSelectors(css) {
  const found = new Set();
  const re = /\.([A-Za-z_][\w-]*)/g;
  let m;
  while ((m = re.exec(css))) found.add(m[1]);
  return found;
}

test('every panel-songs-* class literal in record-door.js has a rule in styles.css', () => {
  const literals = panelSongsClassLiterals(recordDoorSrc);
  assert.ok(literals.size > 0, 'expected at least one panel-songs-* class literal in record-door.js');
  const selectors = cssClassSelectors(cssSelectorsOnly);
  const missing = [...literals].filter((cls) => !selectors.has(cls));
  assert.deepEqual(missing, [], `panel-songs-* classes with no styles.css rule: ${missing.join(', ')}`);
});

test('every class selector in styles.css is used somewhere in src', () => {
  const selectors = cssClassSelectors(cssSelectorsOnly);
  const dead = [...selectors].filter((cls) => !allSrcText.includes(cls));
  assert.deepEqual(dead, [], `styles.css classes with no src reference: ${dead.join(', ')}`);
});
