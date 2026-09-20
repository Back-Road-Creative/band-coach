// The README is the repo's front page, and the repo is public and linked from
// headlessmode.com. For most people who land here the whole job is "get the
// file and open it" — they are not going to build anything.
//
// Before this test the front page opened with "**Status: pre-release.** ...
// Known judging flaws are being fixed before the first public release" (false
// since v1.0.0 was published 2026-09-19T21:59:44Z, draft=false) followed
// immediately by `npm ci` / `npm run build`. The actual download link sat at
// line 267, past the test suite, the storage notes and the build internals.
//
// So: the download link comes before the build instructions, and the page does
// not claim to be unreleased. Both are checked positionally, not just for
// presence, because "the link exists somewhere in a 290-line file" is exactly
// the state this replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const lines = readme.split('\n');

const RELEASE_URL =
  'https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html';

test('the download link appears in the first screenful of the README', () => {
  const at = lines.findIndex(line => line.includes(RELEASE_URL));
  assert.notEqual(at, -1, 'the README no longer contains the release download URL');
  assert.ok(
    at < 25,
    `the download link is at line ${at + 1}; somebody who only wants to run the app ` +
      'should not have to scroll past the build instructions to find it',
  );
});

test('the download link comes before any build command', () => {
  const download = lines.findIndex(line => line.includes(RELEASE_URL));
  const build = lines.findIndex(line => /^\s*npm (ci|run build)\b/.test(line));
  assert.notEqual(build, -1, 'the README no longer shows how to build from source');
  assert.ok(
    download < build,
    `build instructions (line ${build + 1}) come before the download link ` +
      `(line ${download + 1}); the common case is downloading, not building`,
  );
});

test('the README does not claim the app is unreleased', () => {
  // v1.0.0 is public and non-draft, and headlessmode.com links to it. A
  // "pre-release" banner on the front page tells a visitor the download they
  // were just sent to does not exist yet.
  const staleClaims = [
    /status:\s*pre-release/i,
    /before the first public release/i,
    /not (yet )?released/i,
  ];
  const offenders = staleClaims
    .map(re => readme.match(re))
    .filter(Boolean)
    .map(m => m[0]);
  assert.deepEqual(
    offenders,
    [],
    `the README still claims the app is unreleased: ${offenders.join(', ')}`,
  );
});

test('the README still says plainly what the app cannot do', () => {
  // Trimming the status banner must not take the honesty with it. This
  // sentence is the one that stops somebody buying it as a posture coach.
  assert.match(
    readme,
    /cannot see posture, breath, bowing or hand position/,
    'the README no longer states the limits of what Band Coach can hear',
  );
});
