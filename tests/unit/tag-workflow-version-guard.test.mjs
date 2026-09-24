// Every workflow that fires on a `v*` tag must refuse to run when the tag
// disagrees with package.json's version.
//
// On 2026-09-23 the v1.8.0 tag landed on a commit whose package.json still
// said 1.7.0. release.yml had this check and failed cleanly. store-package.yml
// and pages.yml did not: the Store package was built and uploaded stamped
// 1.7.0.0, and GitHub Pages deployed live with version.json saying 1.7.0 —
// both looked finished. The three workflows share the trigger, so they share
// the guard, and it runs before anything is built or deployed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAG_WORKFLOWS = ['release.yml', 'store-package.yml', 'pages.yml'];

function workflow(name) {
  return readFileSync(fileURLToPath(new URL('../../.github/workflows/' + name, import.meta.url)), 'utf8');
}

for (const name of TAG_WORKFLOWS) {
  test(`${name} is tag-triggered and checks the tag against package.json before building`, () => {
    const text = workflow(name);
    assert.match(text, /tags:\s*\n\s*- 'v\*'/, `${name} should run on 'v*' tags`);
    const guardAt = text.search(/- name: tag must match package\.json version/);
    assert.notEqual(guardAt, -1, `${name} has no "tag must match package.json version" step`);
    const guard = text.slice(guardAt);
    assert.match(guard, /GITHUB_REF_NAME/, 'the guard must compare against the pushed tag name');
    assert.match(guard, /require\('\.\/package\.json'\)\.version/, 'the guard must read package.json');
    assert.match(guard, /exit 1/, 'a mismatch must fail the job');
    const firstBuild = text.search(/npm (ci|run build|run pages|test)/);
    assert.ok(firstBuild === -1 || guardAt < firstBuild, `${name}: the guard must run before any install or build step`);
  });
}

test('the Windows store-package workflow runs its guard in bash, not pwsh', () => {
  const text = workflow('store-package.yml');
  const guard = text.slice(text.search(/- name: tag must match package\.json version/));
  const step = guard.slice(0, guard.indexOf('\n      - ', 1));
  assert.match(step, /shell: bash/, 'windows-latest defaults to pwsh, where the sh guard would not parse');
});

test('workflows that also run by hand only apply the guard on a tag push', () => {
  for (const name of ['store-package.yml', 'pages.yml']) {
    const text = workflow(name);
    assert.match(text, /workflow_dispatch:/, `${name} is expected to keep its manual trigger`);
    const guard = text.slice(text.search(/- name: tag must match package\.json version/));
    const step = guard.slice(0, guard.indexOf('\n      - ', 1));
    assert.match(step, /if: github\.ref_type == 'tag'/, `${name}: a manual run has no tag to compare`);
  }
});
