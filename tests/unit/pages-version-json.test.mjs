// Covers dist/pages/version.json: the small file a downloaded, un-updatable
// copy of band-coach.html can fetch cheaply to learn whether it is stale
// (see build/pages.mjs for why the GitHub API itself was rejected for this).
// It must never be served from the service worker's cache — a cached
// version file would just answer with the version the user already has,
// defeating the entire point — so this file also asserts it is written but
// NOT precached.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildPages, PRECACHE_FILES } from '../../build/pages.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OWN_BUILD_DIR = mkdtempSync(join(tmpdir(), 'band-coach-build-'));
const PAGES_DIR = mkdtempSync(join(tmpdir(), 'band-coach-pages-'));
const pages = () => buildPages({ outDir: PAGES_DIR, buildDir: OWN_BUILD_DIR });
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

after(() => {
  rmSync(OWN_BUILD_DIR, { recursive: true, force: true });
  rmSync(PAGES_DIR, { recursive: true, force: true });
});

test('pages build writes version.json with the package version, a real release date and the download URL', async () => {
  await pages();
  const version = JSON.parse(readFileSync(join(PAGES_DIR, 'version.json'), 'utf8'));
  assert.equal(version.version, PKG.version);
  assert.ok(!Number.isNaN(Date.parse(version.released)), `released should parse as a date, got ${version.released}`);
  assert.equal(
    version.download,
    'https://github.com/Back-Road-Creative/band-coach/releases/latest/download/band-coach.html'
  );
});

test('version.json is never precached by the service worker', async () => {
  await pages();
  assert.ok(
    !PRECACHE_FILES.includes('version.json'),
    'version.json must not be in PRECACHE_FILES: a cached copy would report a stale version as current'
  );
  const src = readFileSync(join(PAGES_DIR, 'sw.js'), 'utf8');
  const match = src.match(/const PRECACHE = (\[[^\]]*\]);/);
  assert.ok(match, 'sw.js declares a PRECACHE array');
  const precache = JSON.parse(match[1]);
  assert.ok(!precache.includes('version.json'), 'version.json must not appear in the runtime PRECACHE list either');
});

test("the service worker's fetch handler falls through to the network for version.json instead of serving it from cache", async () => {
  await pages();
  const src = readFileSync(join(PAGES_DIR, 'sw.js'), 'utf8');
  // The fetch handler must not unconditionally serve non-precached requests
  // from whatever's in the cache; it must let the browser fetch them from
  // the network (or fall out of the handler entirely) so a stale copy
  // querying version.json always gets the live file.
  assert.match(
    src,
    /if \(!PRECACHE\.includes\(rel\)\) return;/,
    'requests not in PRECACHE must fall through to the network, not be answered from the cache'
  );
});

// docs/release-notes.json maps a version to one plain-text line; version.json carries it only when the entry exists.
import { writePagesFiles } from '../../build/pages.mjs';
import { writeFileSync } from 'node:fs';
const MIN_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
async function versionJsonWith(notesText, version) {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-notes-'));
  try {
    const notesFile = join(dir, 'release-notes.json');
    if (notesText !== null) writeFileSync(notesFile, notesText, 'utf8');
    await writePagesFiles({ releaseHtml: MIN_HTML, version, outDir: join(dir, 'out'), notesFile });
    return JSON.parse(readFileSync(join(dir, 'out', 'version.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('version.json carries notes when the notes file has an entry for that version', async () => {
  const v = await versionJsonWith('{"1.2.3":"Fixed a thing."}', '1.2.3');
  assert.equal(v.notes, 'Fixed a thing.');
});
test('version.json omits notes when there is no entry, no file, or unreadable JSON; the build does not fail', async () => {
  assert.equal('notes' in await versionJsonWith('{"1.0.0":"Other."}', '1.2.3'), false);
  assert.equal('notes' in await versionJsonWith(null, '1.2.3'), false);
  assert.equal('notes' in await versionJsonWith('not json', '1.2.3'), false);
  assert.equal('notes' in await versionJsonWith('{"1.2.3":7}', '1.2.3'), false);
});
test('the committed notes file has a plain-text line for the current package version', () => {
  const notes = JSON.parse(readFileSync(join(root, 'docs', 'release-notes.json'), 'utf8'));
  assert.equal(typeof notes[PKG.version], 'string');
  assert.ok(notes[PKG.version].length > 0 && notes[PKG.version].length <= 500);
});
