// Unit J1: the light palette's body text must clear WCAG AA's 4.5:1 contrast
// ratio against the light background it sits on. Computed from the actual
// custom-property values in src/styles.css (WCAG 2 relative-luminance
// formula), not eyeballed -- a palette edit that quietly drops contrast
// breaks this test instead of shipping unreadable text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

// Pulls `--name: #hex;` pairs out of one specific rule block (matched by its
// selector text) so this test reads the SAME light-palette block the browser
// applies, not a copy kept in sync by hand.
function varsFromBlock(selectorPattern) {
  const re = new RegExp(selectorPattern.source + '\\s*\\{([^}]*)\\}', selectorPattern.flags);
  const m = css.match(re);
  assert.ok(m, `expected to find a rule block matching ${selectorPattern}`);
  const vars = {};
  for (const decl of m[1].split(';')) {
    const mm = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/.exec(decl);
    if (mm) vars[mm[1]] = mm[2];
  }
  return vars;
}

function relLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hexA, hexB) {
  const la = relLuminance(hexA), lb = relLuminance(hexB);
  const l1 = Math.max(la, lb), l2 = Math.min(la, lb);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('light palette text on ground clears WCAG AA (4.5:1)', () => {
  const light = varsFromBlock(/:root\[data-theme="light"\]/);
  assert.ok(light.text, 'light palette must define --text');
  assert.ok(light.ground, 'light palette must define --ground');
  const ratio = contrastRatio(light.text, light.ground);
  assert.ok(ratio >= 4.5, `--text on --ground contrast is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
});

test('light palette muted text on ground still clears WCAG AA (4.5:1)', () => {
  const light = varsFromBlock(/:root\[data-theme="light"\]/);
  assert.ok(light.muted, 'light palette must define --muted');
  const ratio = contrastRatio(light.muted, light.ground);
  assert.ok(ratio >= 4.5, `--muted on --ground contrast is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
});
