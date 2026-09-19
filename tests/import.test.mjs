import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../band-coach.html', import.meta.url)), 'utf8');

test('the app is one self-contained page', () => {
  assert.match(html, /<title>Band Coach<\/title>/);
  assert.equal((html.match(/<script\b/g) || []).length, 1, 'exactly one inline script');
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/, 'no external script');
});

test('saved progress keeps its storage key', () => {
  assert.match(html, /const KEY = 'bandcoach\.v1'/);
});
