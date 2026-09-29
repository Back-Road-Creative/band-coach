// Every src/*.js file should either be reachable from src/app.js's bundle
// (esbuild would fail to build without it) or be named on the allow-list
// below with a reason a human can check. Without this, a dead module sits in
// the tree forever -- nothing fails, nothing points at it, and each new
// "helper-only, not wired yet" module makes the next dead-code audit harder
// to trust. A 2026-09-28 audit (esbuild metafile reachability from
// src/app.js + a whole-word grep over src/tests/build/store/docs) found
// several song-layer symbols nothing in the app calls; this test is the
// upstream gate that would have caught them landing in the first place, and
// stops a new one from landing unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_JS = join(root, 'src', 'app.js');

// path (relative to repo root, forward slashes) -> why esbuild never reaches
// it from src/app.js. Every key here must still exist on disk (a deleted
// file has to leave this list, not rot in it) and must genuinely be outside
// the bundle -- reachable.test.mjs itself checks both.
const ALLOW_LIST = {
  'src/core/model-pack.js': 'opt-in model loading, parked pending a product decision (plan 2026-09-19 / 09-24)',
  'src/instruments/schema.js': 'instrument record validator, run by tests/unit only',
  'src/song/eval/note-f1.js': 'CI evaluation harness (tests/unit/eval-*.test.mjs)',
  'src/song/eval/pcm.js': 'CI evaluation harness (tests/unit/eval-*.test.mjs)',
  'src/song/eval/roundtrip.js': 'CI evaluation harness (tests/unit/eval-*.test.mjs)',
};

function walkJsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkJsFiles(full, out);
    else if (e.name.endsWith('.js')) out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

test('every src/*.js file is either bundled from src/app.js or named on the allow-list with a reason', async () => {
  const result = await build({
    entryPoints: [SRC_JS],
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    logLevel: 'silent',
    loader: { '.css': 'text' },
    absWorkingDir: root,
  });
  const bundled = new Set(Object.keys(result.metafile.inputs));

  const allFiles = walkJsFiles(join(root, 'src'));
  const unreachable = allFiles.filter((f) => !bundled.has(f));
  const unexplained = unreachable.filter((f) => !(f in ALLOW_LIST));

  assert.deepEqual(
    unexplained,
    [],
    `these src/*.js files are not reachable from src/app.js and are not on reachable.test.mjs's ALLOW_LIST: ${unexplained.join(', ')}`,
  );
});

test('every ALLOW_LIST entry still points at a file that exists', () => {
  const missing = Object.keys(ALLOW_LIST).filter((f) => !existsSync(join(root, f)));
  assert.deepEqual(missing, [], `remove these from reachable.test.mjs's ALLOW_LIST -- the file is gone: ${missing.join(', ')}`);
});
