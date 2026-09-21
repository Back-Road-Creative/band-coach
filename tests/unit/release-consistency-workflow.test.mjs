// After a `v*` tag fires release.yml, pages.yml and store-package.yml, none
// of the three checks that the others agree with it. Two concrete risks:
//
// 1. Every download link anywhere in this app and its docs points at
//    https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html
//    A draft release, a renamed asset, or a repo rename breaks that one URL
//    silently -- and it is the single URL the whole product depends on.
// 2. The Microsoft Store submission is a manual, human step (certification
//    takes days) and nothing records whether it happened for a given
//    release.
//
// This workflow runs after a tag push and catches both. It is tested the
// same way store-package.yml is: by asserting on the workflow file's text,
// since a workflow can't be unit-tested by importing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(
  new URL('../../.github/workflows/release-consistency.yml', import.meta.url),
);

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('the release-consistency workflow exists and is v*-tag triggered', () => {
  const text = workflow();
  assert.match(text, /^name: release-consistency$/m, 'workflow should be named release-consistency');
  assert.match(text, /tags:\s*\n\s*- 'v\*'/, "workflow should run on 'v*' tags");
  assert.match(text, /workflow_dispatch/, 'workflow should also support manual re-runs');
});

test('it checks the latest-download URL every download link depends on', () => {
  const text = workflow();
  assert.match(
    text,
    /releases\/latest\/download\/band-coach\.html/,
    'workflow must curl the exact URL every download link in the app points at',
  );
  assert.match(
    text,
    /curl\s+-sIL/,
    'workflow should use curl -sIL (follow redirects, headers only) to check the URL status',
  );
});

test('the asset check is pinned to the tag that triggered this run, not whatever release is currently latest', () => {
  const text = workflow();
  assert.match(
    text,
    /gh release view\s+"\$TAG"/,
    'workflow must look up the release for the specific triggering tag (gh release view "$TAG"), not the latest release with no argument',
  );
  assert.match(text, /isDraft/, 'the tag-pinned check must confirm the release for this tag is not left as a draft');
  assert.match(
    text,
    /assets/,
    'the tag-pinned check must confirm the band-coach.html asset is actually attached to this tag\'s release',
  );
});

test('the tag-pinned asset check retries instead of failing on the first miss, and still fails after its budget', () => {
  const text = workflow();
  const section = text.match(/release for this tag[\s\S]*?\n\s*exit 1\n/);
  assert.ok(section, 'expected a step verifying the tag-pinned asset that can itself fail the job');
  assert.match(section[0], /attempts=\d+/, 'the tag-pinned asset check should retry a bounded number of times, riding out release.yml still publishing');
  assert.match(section[0], /sleep\s+"?\$?\{?delay\}?"?/, 'the tag-pinned asset check should sleep between attempts');
  assert.match(section[0], /exit 1/, 'the tag-pinned asset check must still fail the job if the budget runs out without the asset ever appearing');
});

test('the latest-download check verifies that "latest" IS this tag, not just an HTTP 200', () => {
  const text = workflow();
  // The property, not the mechanism: whatever this step does, it has to
  // decide something about $TAG. A bare 200 passes identically when "latest"
  // is still the PREVIOUS release, which is the hole this exists to close.
  const section = text.match(/download URL every download link uses[\s\S]*?\n\n/);
  assert.ok(section, 'expected a step checking the download URL every link uses');
  assert.match(
    section[0],
    /releases\/latest/,
    'the check must ask GitHub which release is currently "latest"',
  );
  assert.match(
    section[0],
    /"\$TAG"|\$\{TAG\}/,
    'the answer must be compared against the triggering tag, or the step proves nothing about this release',
  );
});

// Regression guard, from a real measurement rather than a guess. An earlier
// draft of this step followed the redirect with `curl -sIL` and compared
// `url_effective` against releases/download/$TAG/band-coach.html. That is
// wrong: GitHub's first hop does carry the tag-pinned URL, but -L keeps
// going and ends on a signed blob URL at release-assets.githubusercontent.com
// that contains neither the tag nor "releases". The comparison would have
// failed on every healthy release. Pin that it does not come back.
test('the latest check does not compare the fully-followed redirect against a tag path', () => {
  // Comment lines are stripped first: the workflow explains this trap in
  // prose right above the step, and a guard that fired on its own
  // explanation would be unfixable without deleting the explanation.
  const code = workflow()
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  assert.ok(
    !/url_effective[\s\S]{0,400}releases\/download/.test(code),
    'url_effective ends at a signed CDN blob URL, not at releases/download/<tag>/ -- comparing them fails on a good release',
  );
});

test('the asset checks reuse the single resolved tag output rather than a second lookup of the tag name', () => {
  const text = workflow();
  const tagOutputRefs = (text.match(/steps\.tag\.outputs\.tag/g) || []).length;
  assert.ok(
    tagOutputRefs >= 2,
    'the tag resolved once in the "resolve the tag" step should be reused by the asset checks and the version check, not re-derived from gh release view with no tag',
  );
});

test('it checks the deployed Pages version.json against the tag', () => {
  const text = workflow();
  assert.match(text, /version\.json/, 'workflow must fetch version.json from the deployed Pages site');
  assert.match(
    text,
    /back-road-creative\.github\.io\/band-coach/,
    'workflow must fetch version.json from the real deployed Pages host, not a placeholder',
  );
});

test('it retries the version.json check instead of failing on the first miss', () => {
  const text = workflow();
  assert.match(
    text,
    /attempts=\d+/,
    'workflow should define a bounded number of retry attempts rather than looping forever or failing once',
  );
  assert.match(
    text,
    /sleep\s+"?\$?\{?delay\}?"?/,
    'workflow should sleep between retry attempts to ride out Pages deployment lag',
  );
});

test('a version.json miss names version.json in the failure message', () => {
  const text = workflow();
  assert.match(
    text,
    /::error::.*version\.json/,
    'the failure message for a version mismatch must name version.json explicitly so the cause is obvious',
  );
});

test('a broken download URL names what to check, not just that it failed', () => {
  const text = workflow();
  assert.match(
    text,
    /::error::.*(draft|asset|renamed)/i,
    'the download-URL failure message should say what to check (draft release, asset name, repo rename)',
  );
});

test('it creates a tracked Store-submission issue titled for the tag', () => {
  const text = workflow();
  assert.match(
    text,
    /gh issue create/,
    'workflow should use gh issue create to record the manual Store submission step',
  );
  assert.match(
    text,
    /Store submission for/,
    'the issue title should identify itself as the Store submission tracker for this tag',
  );
});

test('issue creation is idempotent: it checks for an existing issue first', () => {
  const text = workflow();
  assert.match(
    text,
    /gh issue list/,
    'workflow must look for an existing issue before creating one, so re-running for the same tag does not open a duplicate',
  );
});

test('the workflow declares issues: write permission', () => {
  const text = workflow();
  assert.match(text, /issues:\s*write/, 'workflow needs issues: write to create the Store-submission issue');
});
