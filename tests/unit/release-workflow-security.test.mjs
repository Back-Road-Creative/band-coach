// release.yml holds the most sensitive token in the repo (a cross-repo dispatch
// secret) and can publish the file people download. Two rules keep that small:
//  - a secret is never expanded inside a `run:` script (it would be pasted into
//    the shell source); it goes through `env:`.
//  - the workflow-level token is read-only; write access is granted on the one
//    job that publishes, not to every step of every job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)), 'utf8');
const lines = text.split('\n');

// Every line that belongs to a `run:` value (inline or block scalar).
function runLines() {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    if (m[2] && !/^[|>][-+]?$/.test(m[2])) { out.push({ n: i + 1, line: m[2] }); continue; }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && lines[j].search(/\S/) <= indent + 1 && !/^\s*#/.test(lines[j])) break;
      out.push({ n: j + 1, line: lines[j] });
    }
  }
  return out;
}

test('the scan sees the run scripts (not vacuous)', () => {
  assert.ok(runLines().length > 20);
});

test('no secret is expanded inside a run: script', () => {
  const bad = runLines().filter((r) => /\$\{\{\s*secrets\./.test(r.line)).map((r) => `release.yml:${r.n} ${r.line.trim()}`);
  assert.deepEqual(bad, [], `secrets must come in through env:\n${bad.join('\n')}`);
});

test('the dispatch token still reaches the steps that use it, through env:', () => {
  assert.match(text, /\n\s+(?:[A-Z_]+): \$\{\{ secrets\.HEADLESSMODE_DISPATCH_TOKEN \}\}/);
});

test('the workflow-level permissions grant no write', () => {
  const m = text.match(/^permissions:\n((?:  .*\n)+)/m);
  assert.ok(m, 'a top-level permissions block must exist');
  assert.doesNotMatch(m[1], /write/, `top-level permissions:\n${m[1]}`);
  assert.match(m[1], /contents: read/);
});

test('contents: write is granted only on the release job', () => {
  const job = text.match(/^jobs:\n(?:.*\n)*?  release:\n((?:    .*\n|\n)+)/m);
  assert.ok(job, 'release job');
  assert.match(job[1], /^    permissions:\n(?:      .*\n)*?      contents: write$/m);
});
