// No comment in src/ or tests/ cites a line number inside app.js: those rot on
// every edit. Name the function or constant instead.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'releases') continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out); else if (/\.(m?js|html|css|md)$/.test(n)) out.push(p);
  }
  return out;
}

test('no comment in src/ or tests/ cites an app.js line number', () => {
  const self = fileURLToPath(import.meta.url);
  const re = new RegExp('app\\.js' + ':[0-9]');
  const hits = [];
  for (const dir of ['src', 'tests']) {
    for (const f of walk(join(ROOT, dir))) {
      if (f === self || f.includes(join('tests', 'fixtures', 'releases'))) continue;
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) hits.push(relative(ROOT, f) + ':' + (i + 1)); });
    }
  }
  assert.deepEqual(hits, [], 'replace line-number citations with the symbol name');
});
