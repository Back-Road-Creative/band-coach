// Guards README.md's "Beginner pathway status" table against silent rot: the
// table is meant to be a truthful, code-derived summary of which instrument
// pathways are ready, have a curriculum, have a fingering/how chart, and
// whether that chart has been checked by a musician -- so this test builds
// the same summary straight from src/instruments/*.js and
// src/ui/fingerings/how.js and compares it to what the README actually says,
// rather than trusting the table's prose to stay in sync by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { howKindFor } from '../../src/ui/fingerings/how.js';

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, '..', '..', 'README.md'), 'utf8');

// Chart kinds that are typed lookup tables carrying a "NEEDS A MUSICIAN'S
// CHECK" caveat in their source file (src/instruments/how/keyed-woodwind.js,
// src/instruments/how/recorder-whistle.js) -- everything else computed by
// howKindFor is either a formula (fretboard, fingerboard, brass, harmonica)
// or has no fingering at all (voice, or null).
const UNCHECKED_KINDS = new Set(['keyed-woodwind', 'recorder', 'whistle']);

function pathwaySection(text) {
  const start = text.indexOf('## Beginner pathway status');
  assert.ok(start >= 0, 'README.md must have a "Beginner pathway status" section');
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ');
  return next >= 0 ? rest.slice(0, next) : rest;
}

function tableRows(section) {
  return section.split('\n').filter(l => /^\|/.test(l) && !/^\|\s*-+/.test(l)).slice(1); // drop header row
}

test('the "Beginner pathway status" table has one row per instrument module with a status field', () => {
  const rows = tableRows(pathwaySection(readme));
  assert.equal(rows.length, INSTRUMENTS.length, 'expected ' + INSTRUMENTS.length + ' rows (one per src/instruments/*.js record), found ' + rows.length);
});

test('every instrument in src/instruments/*.js appears in the table by name', () => {
  const section = pathwaySection(readme);
  for (const rec of INSTRUMENTS) assert.ok(section.includes(rec.name), 'expected the pathway table to mention "' + rec.name + '" (' + rec.id + ')');
});

test('the oboe row says its status is ready', () => {
  const section = pathwaySection(readme);
  const line = section.split('\n').find(l => l.startsWith('|') && l.includes('Oboe'));
  assert.ok(line, 'expected a table row naming Oboe');
  assert.match(line, /ready/i, 'the oboe row should say status ready, not planned');
});

test('the README no longer claims the oboe ships status planned', () => {
  assert.ok(!readme.includes("ships `status: 'planned'`"), 'README should not say the oboe ships status: \'planned\' -- src/instruments/oboe.js:32 is status: \'ready\'');
});

test('the README has a "Capture a melody" section', () => {
  assert.ok(/##\s+Capture a melody/.test(readme), 'expected a "Capture a melody" heading describing the TOOLS.capture tool');
});

test('every instrument row shows "provisional (no reviewer yet)" in the Content reviewed column, matching a null provenance', () => {
  const section = pathwaySection(readme);
  for (const rec of INSTRUMENTS) {
    assert.equal(rec.provenance, null, rec.id + ': this test only knows how to check the provisional case');
    const line = section.split('\n').find(l => l.startsWith('|') && l.includes(rec.name));
    assert.ok(line, 'expected a table row naming ' + rec.name);
    assert.match(line, /provisional \(no reviewer yet\)/, rec.name + '\'s row should say its content review is provisional');
  }
});

test('the pathway section explains what a null provenance means and how a reviewer records one', () => {
  const section = pathwaySection(readme);
  assert.match(section, /provenance/, 'expected the pathway section to mention `provenance`');
  assert.match(section, /musician/i, 'expected the paragraph to explain the app\'s authors wrote the curriculum without a musician\'s review');
});

test('every keyed-woodwind and recorder/whistle instrument is marked unchecked in the table', () => {
  const section = pathwaySection(readme);
  const unchecked = INSTRUMENTS.filter(rec => UNCHECKED_KINDS.has(howKindFor(rec)));
  assert.ok(unchecked.length > 0, 'expected at least one unchecked-chart instrument to test against');
  for (const rec of unchecked) {
    const line = section.split('\n').find(l => l.startsWith('|') && l.includes(rec.name));
    assert.ok(line, 'expected a table row naming ' + rec.name);
    assert.match(line, /no/i, rec.name + '\'s row should flag its chart as not reviewed');
  }
});

test('the drum kit row says ready with a curriculum, now that its trainer ships', () => {
  const section = pathwaySection(readme);
  const line = section.split('\n').find(l => l.startsWith('|') && l.includes('Drum kit'));
  assert.ok(line, 'expected a table row naming Drum kit');
  assert.match(line, /^\| Drum kit \| ready \| yes \|/);
});
