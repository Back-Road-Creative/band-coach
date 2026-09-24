// Guards against the false promise of a separate "Kit Coach" drum page: no
// such page exists anywhere in this repo (verified: no file in any commit,
// none on disk). Drums are being built INTO Band Coach itself, so nothing in
// src/, README.md, docs/**/*.md or store/README.md should point learners at
// a page that doesn't exist -- in any spelling (case-insensitive, with or
// without a hyphen/space).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const SRC_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.css']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (SRC_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMarkdown(full));
    else if (extname(entry) === '.md') out.push(full);
  }
  return out;
}

const files = [
  ...walk(join(root, 'src')),
  join(root, 'README.md'),
  ...walkMarkdown(join(root, 'docs')),
  join(root, 'store', 'README.md'),
];

const KIT_COACH_PATTERN = /kit[\s-]?coach/i;

test('no source or doc file promises a "Kit Coach" page that does not exist', () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (KIT_COACH_PATTERN.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'these files still reference a "Kit Coach" page that does not exist: ' + offenders.join(', '));
});
