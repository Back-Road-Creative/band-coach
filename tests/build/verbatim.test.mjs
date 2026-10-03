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
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../build/build.mjs';

// Builds into its own directory, never the real `dist/`: a dev build rmSync's
// its outDir and test files run concurrently, so a build into `dist/` deletes
// the file other files are reading (see dist-isolation.test.mjs).
const OWN_DIR = mkdtempSync(join(tmpdir(), 'band-coach-verbatim-'));
after(() => rmSync(OWN_DIR, { recursive: true, force: true }));

test('build produces exactly one file in its output dir', async () => {
  // A stray release/ from an earlier `--release` run must not survive a dev build.
  mkdirSync(join(OWN_DIR, 'release'), { recursive: true });
  writeFileSync(join(OWN_DIR, 'release', 'band-coach.html'), 'stale');
  const built = await build({ outDir: OWN_DIR });
  assert.equal(built, join(OWN_DIR, 'band-coach.html'));
  assert.ok(existsSync(built), 'band-coach.html should exist after build');
  const entries = readdirSync(OWN_DIR);
  assert.deepEqual(entries, ['band-coach.html'], 'build should emit exactly one file');
});

test('the built page is one inlined document with no external refs', async () => {
  const html = readFileSync(await build({ outDir: OWN_DIR }), 'utf8');

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
