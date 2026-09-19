// Proves the build produces exactly one self-contained file. The verbatim-
// copy claims themselves (src/app.js === lines 163-770 of the pre-refactor
// band-coach.html, src/styles.css === lines 4-87 before the font-variable
// edit, and the shell's body === lines 89-161) were checked once by hand
// with `cmp` against `main:band-coach.html` when this tree was built — see
// the commit message and the dispatcher's report for those three `cmp`
// results. That can't be re-checked here without shelling out to git from a
// test, which is exactly the kind of fragile, environment-dependent
// assertion this suite avoids.
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../../build/build.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';

const distDir = fileURLToPath(new URL('../../dist/', import.meta.url));

test('build produces exactly one file in dist/', async () => {
  await build();
  assert.ok(existsSync(HTML_PATH), 'dist/band-coach.html should exist after build');
  const entries = readdirSync(distDir);
  assert.deepEqual(entries, ['band-coach.html'], 'build should emit exactly one file');
});

test('the built page is one inlined document with no external refs', async () => {
  await build();
  const html = readFileSync(HTML_PATH, 'utf8');

  assert.equal((html.match(/<script\b/g) || []).length, 1, 'exactly one <script');
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/i, 'no src= on the script tag');
  assert.doesNotMatch(html, /<link\b/i, 'no <link> tags');
  assert.doesNotMatch(html, /@import/i, 'no CSS @import');
  assert.doesNotMatch(
    html,
    /\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i,
    'no http(s) URL inside a src/href attribute'
  );

  const titleIdx = html.indexOf('</title>');
  const headIdx = html.indexOf('</head>');
  assert.ok(titleIdx !== -1 && headIdx !== -1 && titleIdx < headIdx, '</title> appears before </head>');
});
