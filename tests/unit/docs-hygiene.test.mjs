// Public-doc hygiene: one copy of the translated-scope paragraph, contributor commands that match
// package.json, and no maintainer initials in the docs a stranger reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const mdFiles = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? mdFiles(p) : p.endsWith('.md') ? [p] : [];
});

test('README states what is translated exactly once', () => {
  assert.equal(read('README.md').split('What is translated').length - 1, 1);
});

test('no maintainer initials or personal drive path in README, CONTRIBUTING or docs', () => {
  const files = [join(root, 'README.md'), join(root, 'CONTRIBUTING.md'), ...mdFiles(join(root, 'docs'))];
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    assert.doesNotMatch(txt, /\bJP\b/, f + ' names the maintainer by initials');
  }
  assert.doesNotMatch(read('docs/release-acceptance-record.md'), /D:\\band-coach\.html/);
});

test('CONTRIBUTING names the unit and release test scripts and the posttest gate', () => {
  const c = read('CONTRIBUTING.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['test:unit', 'test:release']) {
    assert.ok(pkg.scripts[s], s + ' must exist in package.json');
    assert.ok(c.includes('npm run ' + s), 'CONTRIBUTING.md should name npm run ' + s);
  }
  assert.match(c, /posttest/);
  assert.match(c, /no git hooks/i);
});

test('README Releasing steps name the release-notes entry', () => {
  const r = read('README.md');
  const from = r.indexOf('To cut a release:');
  assert.ok(from > 0);
  const steps = r.slice(from, r.indexOf('Do the [five-minute human check]', from));
  assert.ok(steps.includes('docs/release-notes.json'), 'the numbered steps must mention docs/release-notes.json');
});
