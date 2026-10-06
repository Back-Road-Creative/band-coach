// Every third-party action in .github/workflows must be pinned to a full
// 40-hex commit SHA, with a `# vX.Y.Z` comment saying which release it is.
//
// A mutable tag (@v4) can be moved after review. release.yml holds
// contents: write plus a cross-repo dispatch token, and pages.yml holds
// pages: write and id-token: write, so a retagged action could change the
// band-coach.html that people download. A commit SHA cannot be moved.
// Dependabot (.github/dependabot.yml) keeps the pins current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = `${ROOT}.github/workflows/`;

function usesLines() {
  const out = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    readFileSync(WORKFLOWS + file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
      if (m) out.push({ where: `${file}:${i + 1}`, ref: m[1], rest: m[2] });
    });
  }
  return out;
}

test('the workflows use at least one action (the scan is not vacuous)', () => {
  assert.ok(usesLines().length >= 10);
});

test('every remote action is pinned to a 40-hex commit SHA', () => {
  const bad = usesLines()
    .filter((u) => !u.ref.startsWith('./'))
    .filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u.ref))
    .map((u) => `${u.where} ${u.ref}`);
  assert.deepEqual(bad, [], `unpinned actions:\n${bad.join('\n')}`);
});

test('every pinned action carries a "# vX.Y.Z" version comment', () => {
  const bad = usesLines()
    .filter((u) => !u.ref.startsWith('./'))
    .filter((u) => !/^\s*#\s*v\d+(\.\d+){0,2}\s*$/.test(u.rest))
    .map((u) => `${u.where} ${u.ref}${u.rest}`);
  assert.deepEqual(bad, [], `missing version comment:\n${bad.join('\n')}`);
});

test('dependabot watches github-actions and both npm trees weekly', () => {
  const text = readFileSync(`${ROOT}.github/dependabot.yml`, 'utf8');
  const blocks = text.split(/^\s*- package-ecosystem:/m).slice(1);
  const find = (eco, dir) =>
    blocks.find((b) => b.trim().startsWith(`"${eco}"`) && new RegExp(`directory: "${dir}"`).test(b));
  for (const [eco, dir] of [['github-actions', '/'], ['npm', '/'], ['npm', '/store']]) {
    const b = find(eco, dir);
    assert.ok(b, `dependabot.yml should cover ${eco} at ${dir}`);
    assert.match(b, /interval: "weekly"/, `${eco} ${dir} should update weekly`);
  }
});
