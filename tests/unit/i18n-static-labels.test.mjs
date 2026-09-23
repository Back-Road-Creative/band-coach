// Static scan: every data-i18n="id" marker in src/index.html must have a
// matching entry in the English table, and that entry's text must be
// IDENTICAL to the English text already sitting in the HTML -- so a learner
// whose JS hasn't run yet (or never runs, e.g. a script-blocking browser)
// sees the same words the table would render, and the table can never
// silently drift from what the page ships. Mirrors the id-existence style
// of i18n-app-keys.test.mjs, extended to check the text itself since these
// ids have their English recorded in two places on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/core/i18n.js';

const htmlPath = fileURLToPath(new URL('../../src/index.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

// Scoped to the simple case this slice actually uses: a data-i18n attribute
// immediately followed by the tag's closing '>' and then plain text with no
// nested tags before the next '<'. Anything with nested markup (the h1, the
// "How it decides" paragraph) is intentionally left unconverted for now --
// see the commit message / handoff notes for why.
function findStaticLabels(src) {
  const re = /data-i18n="([^"]+)">([^<]*)</g;
  const found = [];
  let m;
  while ((m = re.exec(src))) found.push({ id: m[1], text: m[2] });
  return found;
}

test('every data-i18n id in index.html exists in the English table', () => {
  const labels = findStaticLabels(html);
  assert.ok(labels.length > 0, 'the scan should find at least one data-i18n label -- otherwise this test proves nothing');
  const missing = labels.filter(l => !Object.prototype.hasOwnProperty.call(en, l.id)).map(l => l.id);
  assert.deepEqual(missing, [], 'data-i18n ids used in index.html but absent from the English table: ' + JSON.stringify(missing));
});

test('the English table text matches the static text already in index.html for every data-i18n id', () => {
  const labels = findStaticLabels(html);
  const mismatches = labels
    .filter(l => Object.prototype.hasOwnProperty.call(en, l.id) && en[l.id] !== l.text)
    .map(l => ({ id: l.id, html: l.text, en: en[l.id] }));
  assert.deepEqual(mismatches, [], 'English table text does not match the HTML fallback text: ' + JSON.stringify(mismatches));
});

test('data-i18n ids are stable dotted strings, never the English text itself', () => {
  const labels = findStaticLabels(html);
  assert.ok(labels.length > 0);
  labels.forEach(l => assert.ok(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(l.id), `id "${l.id}" should look like a dotted lower-camel id, not English text`));
});

test('no data-i18n id duplicates a distinct English text under a different id by accident', () => {
  // Not a strict rule (two ids CAN legitimately share English text, e.g. two
  // separate "End session" buttons in different contexts) -- this only
  // guards against the same id appearing twice with different text, which
  // would mean the HTML and the table can never both be right at once.
  const labels = findStaticLabels(html);
  const seen = new Map();
  labels.forEach(l => {
    if (seen.has(l.id)) assert.equal(l.text, seen.get(l.id), `id "${l.id}" appears twice in index.html with different text`);
    seen.set(l.id, l.text);
  });
});
