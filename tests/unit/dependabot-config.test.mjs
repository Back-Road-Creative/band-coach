// Dependabot used to open one PR per dependency (no `groups:` key), which
// floods the single-developer queue and the shared CI box. Each ecosystem now
// groups its routine bumps into one PR; npm majors stay separate so a breaking
// change is reviewed on its own. A config cannot be imported and the repo has
// no YAML dependency, so this reads the file's text, like the workflow tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8');
const entries = text.split(/^  - package-ecosystem:/m).slice(1).map((b) => {
  const eco = b.match(/^\s*"?([\w-]+)"?/)[1];
  const dir = b.match(/directory:\s*"([^"]+)"/)?.[1];
  const g = b.split(/^    groups:\s*$/m)[1] || '';
  const groupsBlock = g.split(/^    \S/m)[0];
  const groups = [...groupsBlock.matchAll(/^      ([\w-]+):\s*$/gm)].map((m) => m[1]);
  const patterns = [...groupsBlock.matchAll(/^\s+-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]);
  const types = (groupsBlock.split('update-types:')[1] || '').split('\n').map((l) => l.match(/^\s+-\s*"([^"]+)"/)?.[1]).filter(Boolean);
  return { eco, dir, groups, patterns, types };
});

test('the three trees are still covered', () => {
  assert.deepEqual(entries.map((e) => `${e.eco} ${e.dir}`),
    ['github-actions /', 'npm /', 'npm /store']);
});

test('every update entry declares at least one group over every dependency', () => {
  for (const e of entries) {
    assert.ok(e.groups.length > 0, `${e.eco} ${e.dir} has no groups`);
    assert.ok(e.patterns.includes('*'), `${e.eco} ${e.dir} group must match "*"`);
  }
});

test('npm groups list only minor and patch so majors stay separate PRs', () => {
  for (const e of entries.filter((x) => x.eco === 'npm')) {
    assert.deepEqual([...e.types].sort(), ['minor', 'patch'], `${e.dir} update-types`);
  }
});
