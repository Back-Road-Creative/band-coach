import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', '..', 'src');
const alignPath = path.join(__dirname, '..', '..', 'src', 'song', 'align.js');

// Walk src/**/*.js and collect every file path, used both to check for
// imports of align.js and to read align.js's own header.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no src module imports align.js until a free-tempo mode is designed', () => {
  const files = walk(srcDir);
  for (const file of files) {
    if (file === alignPath) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes("./align.js") && !text.includes("../song/align.js"),
      `${file} must not import align.js yet (helper-only, not wired)`);
  }
});

test('the decision is written in the module header', () => {
  const text = readFileSync(alignPath, 'utf8');
  assert.ok(text.includes('Helper-only'), 'align.js header must say Helper-only');
});
