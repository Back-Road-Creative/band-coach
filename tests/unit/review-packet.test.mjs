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

import { buildReviewPacket, reviewItems } from '../../build/review-packet.mjs';
import kbd from '../../src/instruments/kbd.js';
import { ENTRIES } from '../../src/instruments/kbd-songs.js';
import { reviewItems as pathwayReviewItems } from '../../src/instruments/kbd-pathway.js';
import { contentRev } from '../../src/instruments/review-ledger.js';

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
  assert.doesNotMatch(html, /url\(/i);
  assert.doesNotMatch(html, /@import/i);
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
