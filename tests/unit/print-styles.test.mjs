// Unit G3: a @media print block in src/styles.css hides controls/nav/tabs and prints the
// notation/content area black-on-white. Read from the actual src/styles.css block (the same
// pattern theme-contrast.test.mjs uses for the light palette), not a copy kept in sync by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

// Extracts the body of a `@media print { ... }` block, respecting nested braces (the block
// contains ordinary selector rules, each with their own `{ }`).
function printBlock() {
  const start = css.indexOf('@media print');
  assert.ok(start >= 0, 'expected a @media print block in src/styles.css');
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  let i = openBrace;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) break; }
  }
  return css.slice(openBrace + 1, i);
}

test('src/styles.css has a @media print block', () => {
  assert.match(css, /@media print\s*\{/);
});

test('print block hides controls, nav and tab chrome', () => {
  const block = printBlock();
  const hiddenSelectors = ['header', '.picker', '.io', '.setup-sheet', '.side', 'footer', '.editor-toolbar', '.rail-menu', '.help'];
  for (const sel of hiddenSelectors) {
    const re = new RegExp(sel.replace(/[.[\]]/g, '\\$&') + '[^{]*\\{[^}]*display:\\s*none', 'i');
    assert.match(block, re, `expected the print block to set display: none on ${sel}`);
  }
});

test('print block keeps the notation/content area visible and sets black-on-white', () => {
  const block = printBlock();
  assert.doesNotMatch(block, /\.editor-canvas[^{]*\{[^}]*display:\s*none/i, '.editor-canvas must stay visible when printing');
  assert.match(block, /color:\s*#000/i, 'print block should set black text');
  assert.match(block, /background(?:-color)?:\s*#fff/i, 'print block should set a white background');
});
