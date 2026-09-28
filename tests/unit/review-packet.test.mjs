// A review packet is a standalone HTML page a real player opens (no build
// tooling, no dev server) to check one instrument's teaching content --
// curriculum text, song hand-off suggestions, pathway outcome copy -- item
// by item against a named method book or standard, then download a result
// file. This tests build/review-packet.mjs's own contract: every row it
// emits, every id/rev it computes, and that the page never reaches outside
// itself for anything (no external URL of any kind -- it has to work
// completely offline, on a printed-and-forgotten download).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReviewPacket, reviewItems, parseCliArgs } from '../../build/review-packet.mjs';
import kbd from '../../src/instruments/kbd.js';
import { ENTRIES } from '../../src/instruments/kbd-songs.js';
import { reviewItems as pathwayReviewItems } from '../../src/instruments/kbd-pathway.js';
import { contentRev } from '../../src/instruments/review-ledger.js';

// Stricter than a blunt /url\(/i scan over the whole page (which a
// deliberately spaced-out call like "URL.createObjectURL (blob)" can dodge
// without actually being a stylesheet reaching outside the file): this
// checks specifically for the things that would make the page load
// something from outside itself -- a CSS url() inside a <style> block or a
// style="" attribute, an http(s):// or protocol-relative src=/href=, an
// @import, or a <link rel=stylesheet>.
function externalResourceIssues(html) {
  const issues = [];
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const styleAttrs = [...html.matchAll(/\bstyle="([^"]*)"/gi)].map((m) => m[1]);
  for (const block of [...styleBlocks, ...styleAttrs]) if (/url\(/i.test(block)) issues.push('CSS url() found');
  if (/@import/i.test(html)) issues.push('@import found');
  if (/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(html)) issues.push('<link rel=stylesheet> found');
  if (/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html)) issues.push('src=/href= pointing off-page found');
  return issues;
}

function rowsOf(html) {
  const rows = [];
  const re = /<tr\b[^>]*data-id="[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const id = /data-id="([^"]*)"/.exec(tag);
    const rev = /data-rev="([^"]*)"/.exec(tag);
    const midi = /data-midi='([^']*)'/.exec(tag);
    rows.push({ id: id && id[1], rev: rev && rev[1], midi: midi ? JSON.parse(midi[1]) : null });
  }
  return rows;
}

test('the packet never reaches outside itself for anything', () => {
  const html = buildReviewPacket('kbd');
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.deepEqual(externalResourceIssues(html), []);
});

test('the external-resource scan catches a url() injected into a style block (and the normal createObjectURL spelling does not trip it)', () => {
  const html = buildReviewPacket('kbd');
  const injected = html.replace('</style>', 'a{background:url(https://evil.example/x.png)}</style>');
  assert.deepEqual(externalResourceIssues(injected), ['CSS url() found']);
  assert.match(html, /URL\.createObjectURL\(blob\)/, 'the download call keeps its normal, un-spaced spelling');
  assert.match(html, /URL\.revokeObjectURL\(objectUrl\)/, 'the revoke call keeps its normal, un-spaced spelling');
});

test('the object URL is revoked after the click, not in the same tick (a deferred revoke so the download can start first)', () => {
  const html = buildReviewPacket('kbd');
  assert.match(html, /a\.click\(\);[\s\S]*?setTimeout\(function \(\) \{ URL\.revokeObjectURL\(objectUrl\); \}, 0\);/);
});

test('Play reuses one AudioContext across clicks instead of making a new one every time', () => {
  const html = buildReviewPacket('kbd');
  const creationSites = html.match(/new Ctx\(\)/g) || [];
  assert.equal(creationSites.length, 1, 'exactly one place in the page creates an AudioContext');
  assert.match(html, /sharedAudioCtx/);
});

test('parseCliArgs accepts --out before or after the instrument', () => {
  assert.deepEqual(parseCliArgs(['kbd']), { instrument: 'kbd', outPath: undefined });
  assert.deepEqual(parseCliArgs(['kbd', '--out', '/tmp/x.html']), { instrument: 'kbd', outPath: '/tmp/x.html' });
  assert.deepEqual(parseCliArgs(['--out', '/tmp/x.html', 'kbd']), { instrument: 'kbd', outPath: '/tmp/x.html' });
});

// `npm run review-packet` runs from the package root; a relative --out typed
// from another folder must land in that folder (npm's INIT_CWD).
test('CLI: a relative --out lands in the folder npm was run from', () => {
  const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = mkdtempSync(path.join(tmpdir(), 'review-packet-initcwd-'));
  const name = 'review-packet-initcwd-probe.html';
  try {
    const res = spawnSync('node', [path.join(pkgRoot, 'build', 'review-packet.mjs'), 'kbd', '--out', name], {
      encoding: 'utf8', cwd: pkgRoot, env: { ...process.env, INIT_CWD: dir }
    });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(path.join(dir, name)), 'the packet is written where the player typed the path');
  } finally {
    rmSync(path.join(pkgRoot, name), { force: true });
  }
});

test('every curriculum entry, song hand-off entry and pathway outcome appears exactly once, with no duplicate ids', () => {
  const html = buildReviewPacket('kbd');
  const rows = rowsOf(html);
  const expectedIds = new Set([
    ...kbd.curriculum.map((c) => 'kbd.curriculum.' + c.level),
    ...ENTRIES.map((e) => e.id),
    ...pathwayReviewItems().map((p) => p.id)
  ]);
  const gotIds = rows.map((r) => r.id);
  assert.equal(gotIds.length, kbd.curriculum.length + ENTRIES.length + pathwayReviewItems().length);
  assert.equal(new Set(gotIds).size, gotIds.length, 'no duplicate ids');
  assert.deepEqual(new Set(gotIds), expectedIds);
});

test("every row's data-rev matches contentRev of the ID/REV CONTRACT item, never kbd-songs reviewItems() output", () => {
  const html = buildReviewPacket('kbd');
  const rows = rowsOf(html);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of kbd.curriculum) assert.equal(byId.get('kbd.curriculum.' + c.level).rev, contentRev(c));
  for (const e of ENTRIES) assert.equal(byId.get(e.id).rev, contentRev(e));
  for (const p of pathwayReviewItems()) assert.equal(byId.get(p.id).rev, contentRev(p.value));
});

test('the packet has the review header fields, a download button and inline WebAudio', () => {
  const html = buildReviewPacket('kbd');
  assert.match(html, /id="reference"/);
  assert.match(html, /id="reviewedBy"/);
  assert.match(html, /id="reviewedAt"/);
  assert.match(html, /id="downloadResult"/);
  assert.match(html, /AudioContext/);
});

test('curriculum level 1 carries its taught pitches; every song row carries non-empty midi', () => {
  const html = buildReviewPacket('kbd');
  const rows = rowsOf(html);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.get('kbd.curriculum.1').midi, [60, 62, 64]);
  for (const e of ENTRIES) assert.ok(byId.get(e.id).midi && byId.get(e.id).midi.length > 0, e.id + ' should carry midi');
});

test('the inline player spaces plain-list and dyad notes out by index instead of stacking them as a chord', () => {
  const html = buildReviewPacket('kbd');
  assert.match(html, /\(midiOrSchedule \|\| \[\]\)\.forEach\(function \(m, i\) \{ tone\(m, i \* [0-9.]+, [0-9.]+\); \}\)/, 'plain-list notes must use a non-zero, index-based start time');
  assert.match(html, /pair\.forEach\(function \(m\) \{ tone\(m, i \* [0-9.]+, [0-9.]+, [0-9.]+\); \}\)/, 'dyad notes must use a non-zero, index-based start time and a lowered gain');
});

test('reviewItems(kbd) returns the same 26 id/rev pairs the built page shows; an unsupported instrument throws', () => {
  const items = reviewItems('kbd');
  const html = buildReviewPacket('kbd');
  const rows = rowsOf(html);
  assert.equal(items.length, rows.length);
  const itemPairs = new Set(items.map((i) => i.id + '|' + i.rev));
  const rowPairs = new Set(rows.map((r) => r.id + '|' + r.rev));
  assert.deepEqual(itemPairs, rowPairs);
  assert.throws(() => reviewItems('gtr'), /gtr/);
  assert.throws(() => buildReviewPacket('gtr'), /gtr/);
});
