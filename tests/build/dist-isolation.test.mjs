// node:test runs test FILES concurrently, and a dev `build()` starts with
// rmSync(outDir), so any test that calls build() against the real `dist/`
// deletes `dist/band-coach.html` while other files are reading it (CI run
// 37142606428: pages.test.mjs hit ENOENT that way). Every test that calls the
// project's build() must therefore hand it its own `outDir`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('../', import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

// The call's argument text up to its matching close paren.
function callArgs(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

function unisolatedBuildCalls(src) {
  src = stripComments(src);
  if (!/import\s*\{[^}]*\bbuild\b[^}]*\}\s*from\s*'[^']*build\/build\.mjs'/.test(src)) return [];
  const bad = [];
  for (const m of src.matchAll(/(?<![\w.$])build\s*\(/g)) {
    const args = callArgs(src, m.index + m[0].length - 1);
    if (!/\boutDir\b/.test(args)) bad.push(args);
  }
  return bad;
}

test('the guard flags a build() with no outDir and passes one with its own', () => {
  const imp = "import { build } from '../../build/build.mjs';\n";
  assert.equal(unisolatedBuildCalls(imp + 'await build();').length, 1);
  assert.equal(unisolatedBuildCalls(imp + 'await build({ release: true });').length, 1);
  assert.equal(unisolatedBuildCalls(imp + 'await build({ outDir: d });').length, 0);
  assert.equal(unisolatedBuildCalls("import { build } from 'esbuild';\nawait build({});").length, 0);
});

test('no test file calls build() against the shared dist/', () => {
  const offenders = [];
  for (const f of walk(testsDir)) {
    if (f === fileURLToPath(import.meta.url)) continue; // its own sample sources
    const n = unisolatedBuildCalls(readFileSync(f, 'utf8')).length;
    if (n) offenders.push(`${relative(testsDir, f)} (${n} call${n > 1 ? 's' : ''})`);
  }
  assert.deepEqual(offenders, [], 'give each build() its own mkdtemp outDir');
});
