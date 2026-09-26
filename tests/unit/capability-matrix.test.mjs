import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { INSTRUMENTS, byId } from '../../src/instruments/index.js';
import { capabilityFor, capabilityMatrix, TIERS } from '../../src/instruments/capability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.join(__dirname, '..', '..', 'docs', 'capabilities.md');

test('capabilityMatrix() covers every instrument record with a valid tier', () => {
  const matrix = capabilityMatrix();
  assert.equal(matrix.length, INSTRUMENTS.length);
  const ids = new Set(INSTRUMENTS.map(r => r.id));
  for (const cap of matrix) {
    assert.ok(ids.has(cap.id), cap.id + ' is not an instrument id');
    assert.ok(TIERS.includes(cap.tier), cap.id + ': tier ' + cap.tier + ' is not one of ' + TIERS.join('|'));
    assert.equal(typeof cap.practise, 'boolean', cap.id + '.practise must be boolean');
    assert.ok(['midi', 'mic-single-note', 'tap', 'none'].includes(cap.assess), cap.id + ': assess ' + cap.assess);
    assert.ok(['computed', 'typed-unreviewed', 'typed-reviewed', 'none'].includes(cap.chart), cap.id + ': chart ' + cap.chart);
    assert.equal(typeof cap.contentReviewed, 'boolean', cap.id + '.contentReviewed must be boolean');
  }
});

test('capabilityFor(rec) is fully derived: never hand-typed per instrument', () => {
  // Keyboard: input is exactly 'midi', ready -- the one complete assessed
  // pathway today.
  const kbd = capabilityFor(byId.kbd);
  assert.equal(kbd.tier, 'first-release-candidate');
  assert.equal(kbd.assess, 'midi');
  assert.equal(kbd.chart, 'none');
  assert.equal(kbd.practise, true);

  // A keyed-woodwind record (mic-only, typed chart, provenance null):
  // accessible today, nothing checked by a musician.
  const clarinet = capabilityFor(byId['clarinet-bb']);
  assert.equal(clarinet.tier, 'accessible-unvalidated');
  assert.equal(clarinet.assess, 'mic-single-note');
  assert.equal(clarinet.chart, 'typed-unreviewed');
  assert.equal(clarinet.contentReviewed, false);

  // Drum kit: input 'mic+midi' -- carries MIDI, but the mic path is
  // onset-only and no e-kit has actually been tried against this app, so
  // it sits one notch below a complete pathway.
  const drums = capabilityFor(byId['drum-kit']);
  assert.equal(drums.tier, 'supported-untested');
  assert.equal(drums.assess, 'midi');
  assert.equal(drums.chart, 'typed-unreviewed');

  // A computed-chart, mic-only instrument (guitar): still accessible-
  // unvalidated -- the chart is a trustworthy formula, but the record's
  // curriculum content itself carries no reviewer.
  const gtr = capabilityFor(byId.gtr);
  assert.equal(gtr.tier, 'accessible-unvalidated');
  assert.equal(gtr.chart, 'computed');

  // A planned record (synthetic: no record in today's data is planned,
  // see tests/unit/instruments.test.mjs's MODS-parity test) is 'planned'
  // regardless of its intended input, and nothing on it is assessable yet.
  const planned = capabilityFor({ id: 'test-planned', name: 'Test Planned', status: 'planned', input: 'midi', provenance: null });
  assert.equal(planned.tier, 'planned');
  assert.equal(planned.practise, false);
  assert.equal(planned.assess, 'none');
});

test('a fully-reviewed provenance flips contentReviewed and a typed chart to reviewed', () => {
  const reviewedProvenance = { reference: 'Standard of Excellence, Book 1', reviewedBy: 'A. Reviewer', reviewedAt: '2026-09-24' };
  const cap = capabilityFor({ ...byId['clarinet-bb'], provenance: reviewedProvenance });
  assert.equal(cap.contentReviewed, true);
  assert.equal(cap.chart, 'typed-reviewed');
});

test('docs/capabilities.md has a row for every instrument matching the computed capability', () => {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const tableStart = doc.indexOf('| id ');
  assert.ok(tableStart >= 0, 'expected a "| id | ..." markdown table header in docs/capabilities.md');
  const tableSection = doc.slice(tableStart);
  const rows = tableSection.split('\n').filter(l => l.startsWith('|')).slice(2); // skip header + separator

  const byIdInDoc = new Map();
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter((c, i, arr) => !(i === 0 || i === arr.length - 1));
    if (cells.length === 0 || !cells[0]) continue;
    byIdInDoc.set(cells[0], cells);
  }

  for (const rec of INSTRUMENTS) {
    const cap = capabilityFor(rec);
    const cells = byIdInDoc.get(rec.id);
    assert.ok(cells, 'docs/capabilities.md is missing a row for ' + rec.id);
    const [, , practise, assess, chart, contentReviewed, tier] = cells;
    assert.equal(practise, String(cap.practise), rec.id + '.practise');
    assert.equal(assess, cap.assess, rec.id + '.assess');
    assert.equal(chart, cap.chart, rec.id + '.chart');
    assert.equal(contentReviewed, String(cap.contentReviewed), rec.id + '.contentReviewed');
    assert.equal(tier, cap.tier, rec.id + '.tier');
  }
});

test('docs/capabilities.md marks its first-release assumptions as awaiting the product owner', () => {
  const doc = readFileSync(DOC_PATH, 'utf8');
  assert.ok(/JP to confirm/.test(doc), 'expected the phrase "JP to confirm" in docs/capabilities.md');
});
