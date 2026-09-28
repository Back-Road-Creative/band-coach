// Dead code does not get to stay. Three mechanical checks over src/ that the
// 2026-09-28 audit found violated (5 unused locals, 2 unused imports, 24
// exports nothing outside their file referenced), each of which had crept in
// across ordinary feature PRs -- so the checks live in the suite rather than
// in a one-off sweep. Comments are stripped first: a name that only survives
// in prose is not a use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const wordRe = (name) => new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g');
const count = (text, name) => (text.match(wordRe(name)) || []).length;

const srcFiles = walk(join(root, 'src'));
const src = new Map(srcFiles.map((f) => [relative(root, f), stripComments(readFileSync(f, 'utf8'))]));
const others = ['tests', 'build', 'store']
  .filter((d) => statSync(join(root, d), { throwIfNoEntry: false }))
  .flatMap((d) => walk(join(root, d)))
  .map((f) => stripComments(readFileSync(f, 'utf8')))
  .join('\n');

test('no src file imports a binding it never uses', () => {
  const unused = [];
  for (const [f, t] of src) {
    for (const m of t.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name && count(t, name) === 1) unused.push(`${f}: ${name}`);
      }
    }
  }
  assert.deepEqual(unused, []);
});

test('no src file declares a function or binding it never reads', () => {
  const unused = [];
  // Exported declarations are the next test's business; a name that is not
  // exported can only be read from its own file, so one occurrence is dead.
  const decl = /^\s*(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  for (const [f, t] of src) {
    for (const m of t.matchAll(decl)) {
      const name = m[1] || m[2];
      if (count(t, name) === 1) unused.push(`${f}:${t.slice(0, m.index).split('\n').length}: ${name}`);
    }
  }
  assert.deepEqual(unused, []);
});

function srcUsesElsewhere(file, name) {
  for (const [g, u] of src) if (g !== file && count(u, name) > 0) return true;
  return false;
}

test('every export is referenced from some other file (src, tests, build or store)', () => {
  const dead = [];
  for (const [f, t] of src) {
    const names = new Set();
    for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name && name !== 'default') names.add(name);
      }
    }
    for (const name of names) {
      if (!srcUsesElsewhere(f, name) && count(others, name) === 0) dead.push(`${f}: ${name}`);
    }
  }
  assert.deepEqual(dead, [], 'drop the export keyword, or the symbol itself if nothing in its own file reads it either');
});
