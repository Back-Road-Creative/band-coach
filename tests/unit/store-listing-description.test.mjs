// The Microsoft Store shows store/package.json's "description" to shoppers.
//
// electron-builder copies it verbatim into the appx manifest: AppInfo reads
// `description` off the packaged app's metadata, and AppxTarget writes it into
// both <Properties><Description> and <uap:VisualElements Description="...">.
// Verified empirically, not inferred — the manifest inside the artifact from
// store-package run 35543421547 ("Band Coach 1.2.0.0.appx") carried a
// byte-exact copy of the description string that was in store/package.json at
// that commit.
//
// That string used to be a note to whoever maintains this folder: "Thin
// Electron desktop shell that packages the built band-coach.html as a Windows
// Store MSIX (appx). The learning app itself lives entirely in ../src and
// ../dist; nothing here is loaded by the browser build." Correct for a
// developer, meaningless to somebody deciding whether to install a music
// practice app.
//
// Fixing it once is not enough, because the field reads like internal
// package metadata and the next person to touch it has no way to know it is
// published. This test is the sign on the field. The developer-facing
// explanation lives in store/README.md, which is where a maintainer looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storePkg = JSON.parse(
  readFileSync(new URL('../../store/package.json', import.meta.url), 'utf8'),
);
const description = storePkg.description;

test('the store description exists and is a non-trivial sentence', () => {
  assert.equal(typeof description, 'string');
  assert.ok(
    description.trim().length >= 40,
    `store description is too short to tell anyone anything: ${JSON.stringify(description)}`,
  );
});

test('the store description fits the appx manifest Description limit', () => {
  // AppxManifest's Description is capped at 2048 characters; a longer one is
  // rejected at packaging time, which would fail the release tag's build
  // rather than the Store upload.
  assert.ok(
    description.length <= 2048,
    `store description is ${description.length} chars, over the 2048 manifest limit`,
  );
});

test('the store description is written for a shopper, not a maintainer', () => {
  // Each of these appeared in, or belongs to, the developer note this field
  // used to hold. None of them mean anything to somebody reading a Store
  // listing.
  const maintainerJargon = [
    'electron',
    'msix',
    'appx',
    'package.json',
    '../src',
    '../dist',
    'browser build',
    'repo',
    'build script',
    'node_modules',
  ];
  const lowered = description.toLowerCase();
  const found = maintainerJargon.filter(term => lowered.includes(term));
  assert.deepEqual(
    found,
    [],
    `store description is published to Store shoppers but contains maintainer jargon: ${found.join(', ')}`,
  );
});

test('the store description says what the app actually does', () => {
  // A listing that names none of the app's capabilities is not a listing.
  // These are the features the app really ships, not aspirational copy.
  // Matched on word boundaries, not as substrings: a bare `includes('ear')`
  // is satisfied by the word "learning", which is how the old developer note
  // passed this check while naming no capability at all.
  const capabilities = ['tuner', 'tune', 'tuning', 'pitch', 'midi', 'practice', 'rhythm', 'ear'];
  const named = capabilities.filter(term =>
    new RegExp(`\\b${term}\\b`, 'i').test(description),
  );
  assert.notDeepEqual(
    named,
    [],
    `store description names none of the app's capabilities: ${JSON.stringify(description)}`,
  );
});

test('the maintainer explanation still exists, in store/README.md', () => {
  // The developer note was not deleted, it was moved. If somebody ever
  // deletes it from the README, this fails rather than quietly losing the
  // only explanation of why this folder has its own package.json.
  const readme = readFileSync(new URL('../../store/README.md', import.meta.url), 'utf8');
  assert.match(
    readme,
    /own\s+`package\.json`/,
    'store/README.md no longer explains why this folder has its own package.json',
  );
});
