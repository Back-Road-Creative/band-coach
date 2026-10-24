// src/core/escape.js: the one HTML escaper and the one XML escaper. They are
// separate on purpose: HTML writes an apostrophe as the numeric &#39; (older
// HTML parsers do not know &apos;), XML writes the named &apos;.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, escapeXml } from '../../src/core/escape.js';

test('escapeHtml escapes the five reserved characters, apostrophe as &#39;', () => {
  assert.equal(escapeHtml('<a & b> "c\' d"'), '&lt;a &amp; b&gt; &quot;c&#39; d&quot;');
});

test('escapeXml escapes the five reserved characters, apostrophe as &apos;', () => {
  assert.equal(escapeXml('<a & b> "c\' d"'), '&lt;a &amp; b&gt; &quot;c&apos; d&quot;');
});

test('both escape the ampersand first, so an existing entity is not left half-escaped', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
});

test('both accept non-strings and leave plain text alone', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeXml(null), 'null');
  assert.equal(escapeHtml('plain text'), 'plain text');
  assert.equal(escapeXml('plain text'), 'plain text');
});
