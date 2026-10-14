// Pins the two gates a tag must pass beyond the suite: release.yml refuses
// unless ci.yml went green on the tag's commit (before it installs or
// publishes anything), and release-consistency.yml compares the published
// asset's sha256 with the tested build and runs the acceptance-record check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const wf = (n) => readFileSync(fileURLToPath(new URL('../../.github/workflows/' + n, import.meta.url)), 'utf8');

test('release.yml: a successful ci.yml run for the tag commit is required before npm ci and publish', () => {
  const t = wf('release.yml');
  assert.match(t, /^permissions:\n(?:  .*\n)*?  actions: read$/m, 'listing runs needs actions: read');
  const at = t.indexOf('gh run list --workflow ci.yml --commit "$GITHUB_SHA" --status success --json databaseId');
  assert.notEqual(at, -1, 'no CI-run gate');
  assert.ok(at < t.indexOf('- run: npm ci'), 'gate must precede npm ci');
  assert.ok(at < t.indexOf('gh release create'), 'gate must precede publish');
  const step = t.slice(t.lastIndexOf('      - name:', at), t.indexOf('\n      - ', at));
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /exit 1/);
  assert.match(step, /::error::.*ci\.yml/, 'a readable message');
  assert.doesNotMatch(step, /continue-on-error/);
});

test('release-consistency.yml: sha256 compare and the record check are wired in', () => {
  const t = wf('release-consistency.yml');
  assert.match(t, /node build\/check-acceptance-record\.mjs docs\/release-acceptance-record\.md "\$TAG_SHA"/);
  assert.match(t, /gh release download "\$TAG" --repo "\$GITHUB_REPOSITORY" --pattern band-coach\.html/);
  assert.match(t, /npm run build -- --release/);
  assert.match(t, /sha256sum dist\/release\/band-coach\.html/);
  assert.match(t, /\[ "\$published" != "\$built" \]/);
  assert.match(t, /uses: actions\/checkout@/);
});
