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
// The document-head assertions that depend on fixing E1/E2 (no <link>, no
// http(s) URL in a src/href attribute, </title> before </head>) are added
// in the next commit alongside that fix — see tests/characterization/load.test.mjs
// and the commit that removes the Google Fonts request.
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

test('the built page has exactly one inline script and no external script', async () => {
  await build();
  const html = readFileSync(HTML_PATH, 'utf8');

  assert.equal((html.match(/<script\b/g) || []).length, 1, 'exactly one <script');
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/i, 'no src= on the script tag');
});
