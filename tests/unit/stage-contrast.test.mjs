import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// BC-10: `.stage` (src/styles.css) paints a fixed dark gradient behind its
// descendants in BOTH themes, but those descendants (e.g. `.opts`, `#hint`)
// read theme tokens like `--muted`. In the light theme `--muted` is a dark
// navy meant to read on a light `--panel`, not on the stage's own permanent
// dark gradient, so contrast collapses. This test proves the `.stage` rule
// re-pins the tokens its descendants use to dark-palette values, so the
// gradient always gets dark-theme text regardless of which theme is active.

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'styles.css');
const css = readFileSync(cssPath, 'utf8');

// WCAG 2.x relative luminance + contrast ratio maths (no deps).
function srgbToLinear(c) { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); }
function hexToRgb(hex) { const h = hex.replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; const v = parseInt(n, 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }; }
function relLuminance(hex) { const { r, g, b } = hexToRgb(hex); return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b); }
function contrastRatio(hexA, hexB) { const l1 = relLuminance(hexA); const l2 = relLuminance(hexB); const lighter = Math.max(l1, l2); const darker = Math.min(l1, l2); return (lighter + 0.05) / (darker + 0.05); }

const GRADIENT_TOP = '#0d111c';
const GRADIENT_BOTTOM = '#05070c';
const LIGHT_MUTED = '#4a5570';

test('sanity: WCAG contrast maths matches known reference pairs', () => {
  // Black on white is the canonical 21:1 max-contrast pair.
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  // Identical colours are always 1:1.
  assert.ok(Math.abs(contrastRatio('#123456', '#123456') - 1) < 0.001);
});

test('documents the defect: the bare light --muted fails against the stage gradient', () => {
  const ratio = contrastRatio(LIGHT_MUTED, GRADIENT_BOTTOM);
  assert.ok(ratio < 4.5, `expected light --muted (${LIGHT_MUTED}) to FAIL WCAG AA against the stage gradient bottom stop (${GRADIENT_BOTTOM}), got ${ratio.toFixed(2)}:1 -- this is exactly why .stage must re-pin its own tokens`);
});

function extractRuleBlock(source, selectorPattern) {
  const match = source.match(selectorPattern);
  if (!match) return null;
  const braceStart = source.indexOf('{', match.index);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') { depth--; if (depth === 0) return source.slice(braceStart + 1, i); }
  }
  return null;
}

function extractCustomProp(block, name) {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const match = block.match(re);
  return match ? match[1].trim() : null;
}

test('.stage redefines --text and --muted to dark-palette values that pass AA against its own gradient', () => {
  const stageBlock = extractRuleBlock(css, /\.stage\s*\{/);
  assert.ok(stageBlock, 'could not find the .stage rule block in src/styles.css');

  const scopedText = extractCustomProp(stageBlock, '--text');
  const scopedMuted = extractCustomProp(stageBlock, '--muted');

  assert.ok(scopedText, '.stage must redefine --text so descendants render dark-theme text regardless of the active theme');
  assert.ok(scopedMuted, '.stage must redefine --muted so descendants like #hint/.opts render dark-theme text regardless of the active theme');

  for (const [name, value] of [['--text', scopedText], ['--muted', scopedMuted]]) {
    for (const stop of [GRADIENT_TOP, GRADIENT_BOTTOM]) {
      const ratio = contrastRatio(value, stop);
      assert.ok(ratio >= 4.5, `${name}: ${value} scoped inside .stage must contrast >= 4.5:1 against gradient stop ${stop}, got ${ratio.toFixed(2)}:1`);
    }
  }
});

test('.stage sets color-scheme: dark so native controls inside the stage follow the dark palette', () => {
  const stageBlock = extractRuleBlock(css, /\.stage\s*\{/);
  assert.ok(stageBlock, 'could not find the .stage rule block in src/styles.css');
  assert.match(stageBlock, /color-scheme\s*:\s*dark\s*;/, '.stage must set color-scheme: dark');
});
