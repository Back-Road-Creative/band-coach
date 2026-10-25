// The README paragraph that says what Settings > Language translates must name every
// top-level key group the Spanish table in src/core/i18n.js carries, so a new group
// cannot ship while the README still says it is English-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../../src/core/i18n.js', import.meta.url), 'utf8');

// Prefixes deliberately not listed in the README scope paragraph. Keep empty unless a
// group is purely internal (never shown to a learner); say why beside each entry.
const NOT_LISTED = [];

function scopeParagraph() {
  const at = readme.indexOf('What is translated');
  assert.notEqual(at, -1, 'README must keep a "What is translated" scope paragraph');
  const start = readme.lastIndexOf('\n\n', at) + 2;
  const end = readme.indexOf('\n\n', at);
  return readme.slice(start, end === -1 ? undefined : end);
}

function spanishPrefixes() {
  const from = i18n.indexOf('export const es = {');
  const to = i18n.indexOf('export const LOCALES');
  assert.ok(from !== -1 && to > from, 'src/core/i18n.js must still export the es table before LOCALES');
  const prefixes = new Set();
  for (const m of i18n.slice(from, to).matchAll(/^\s*'([A-Za-z0-9_]+)\.[^']*':/gm)) prefixes.add(m[1]);
  return [...prefixes].sort();
}

test('the Spanish table has key groups to check', () => {
  assert.ok(spanishPrefixes().length > 20);
});

test('the README scope paragraph names every Spanish key group as `group.*`', () => {
  const para = scopeParagraph();
  const missing = spanishPrefixes().filter((p) => !NOT_LISTED.includes(p) && !para.includes('`' + p + '.*`'));
  assert.deepEqual(missing, [], 'key groups missing from the README "What is translated" paragraph');
});

test('the exclusion list only names groups that exist', () => {
  const real = spanishPrefixes();
  for (const p of NOT_LISTED) assert.ok(real.includes(p), p + ' is not a key group any more; drop it from NOT_LISTED');
});
