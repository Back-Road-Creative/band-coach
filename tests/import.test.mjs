import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HTML_PATH } from './helpers/html-path.mjs';

const html = readFileSync(HTML_PATH, 'utf8');
// esbuild rewrites the source's single-quoted `const KEY = 'bandcoach.v1'`
// (format may change `const` and the quote style), so the exact source
// literal is only guaranteed in src/app.js; the built file is checked below
// for the string itself.
const appJs = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');

test('the app is one self-contained page', () => {
  assert.match(html, /<title>Band Coach<\/title>/);
  assert.equal((html.match(/<script\b/g) || []).length, 1, 'exactly one inline script');
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/, 'no external script');
});

test('saved progress keeps its storage key', () => {
  assert.match(appJs, /const KEY = 'bandcoach\.v1'/);
  assert.match(html, /bandcoach\.v1/, 'the built file still carries the storage key literal');
});
