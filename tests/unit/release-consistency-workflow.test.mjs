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
