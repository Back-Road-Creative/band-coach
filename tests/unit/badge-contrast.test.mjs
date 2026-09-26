// P7-5: the Songs panel's "Play it on..." instrument-card feasibility badges
// (.panel-songs-badge) and difficulty badges (.panel-songs-diff-badge) paint
// their meaning colour (--good/--warn/--bad/--muted) as a background with a
// hard-coded #000 or #fff ink on top, so the ink only clears WCAG AA in
// whichever theme happens to match the colour's own brightness -- the axe
// scan in tests/characterization/a11y-axe.test.mjs caught this as a real
// "serious" color-contrast violation once a song is open. This test computes
// the WCAG 2 relative-luminance contrast ratio for every badge
// background/ink pair, in both themes, straight from src/styles.css's own
// custom properties (not eyeballed), so a future palette edit that drops a
// pair below 4.5:1 fails here instead of shipping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../../src/styles.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

// Pulls `--name: #hex;` pairs out of one specific rule block (matched by its
// selector text) so this test reads the SAME blocks the browser applies, not
// a copy kept in sync by hand. Accepts 3- or 6-digit hex so ink tokens
// written as #000/#fff still parse.
function varsFromBlock(selectorPattern) {
  const m = css.match(selectorPattern);
  assert.ok(m, `expected to find a rule block matching ${selectorPattern}`);
  const vars = {};
  for (const decl of m[1].split(';')) {
    const mm = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\b/.exec(decl);
    if (mm) vars[mm[1]] = mm[2];
  }
  return vars;
}

function relLuminance(hex) {
  const full = hex.length === 4
    ? '#' + [...hex.slice(1)].map((c) => c + c).join('')
    : hex;
  const n = parseInt(full.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hexA, hexB) {
  const la = relLuminance(hexA), lb = relLuminance(hexB);
  const l1 = Math.max(la, lb), l2 = Math.min(la, lb);
  return (l1 + 0.05) / (l2 + 0.05);
}

// The primary (dark, committed-default) :root block -- matched by requiring
// a literal "{" right after ":root" so the nested ":root:not(...)" (light
// media query) and ":root[data-theme=\"light\"]" blocks below can't match.
const DARK_ROOT = /:root\s*\{([^}]*)\}/;
const LIGHT_ROOT = /:root\[data-theme="light"\]\s*\{([^}]*)\}/;

const MEANING_KEYS = ['good', 'warn', 'bad', 'muted'];

for (const [label, pattern] of [['dark', DARK_ROOT], ['light', LIGHT_ROOT]]) {
  test(`${label} theme: badge background/ink pairs clear WCAG AA (4.5:1)`, () => {
    const vars = varsFromBlock(pattern);
    for (const key of MEANING_KEYS) {
      assert.ok(vars[key], `${label} theme must define --${key}`);
      const inkKey = `${key}-ink`;
      assert.ok(vars[inkKey], `${label} theme must define --${inkKey}`);
      const ratio = contrastRatio(vars[key], vars[inkKey]);
      assert.ok(
        ratio >= 4.5,
        `${label} --${key} (${vars[key]}) with --${inkKey} (${vars[inkKey]}) is ${ratio.toFixed(2)}:1, need >= 4.5:1`,
      );
    }
  });
}
