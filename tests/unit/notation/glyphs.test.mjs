import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEF_PATHS, ACCIDENTAL_PATHS, REST_PATHS, FILLED_RESTS } from '../../../src/notation/glyphs.js';

// Every path must be a non-empty SVG path-data string (usable as <path d="...">
// or `new Path2D(d)`), and every glyph in a table must be distinct from its siblings
// so callers can tell them apart on screen.
function assertValidPathData(d, label) {
  assert.equal(typeof d, 'string', `${label}: path data must be a string`);
  assert.ok(d.length > 0, `${label}: path data must not be empty`);
  assert.match(d, /^M/, `${label}: path data must start with a moveto command`);
  assert.doesNotMatch(d, /["<>&]/, `${label}: path data must be safe to embed unescaped in an XML attribute`);
}

test('CLEF_PATHS: every clef layout.js can request has its own path', () => {
  for (const clef of ['treble', 'bass', 'alto', 'tenor', 'percussion']) {
    assertValidPathData(CLEF_PATHS[clef], `clef ${clef}`);
  }
});

test('CLEF_PATHS: alto and tenor share the same C-clef shape', () => {
  assert.equal(CLEF_PATHS.tenor, CLEF_PATHS.alto);
});

test('CLEF_PATHS: distinct clefs render distinct shapes', () => {
  const shapes = new Set([CLEF_PATHS.treble, CLEF_PATHS.bass, CLEF_PATHS.alto, CLEF_PATHS.percussion]);
  assert.equal(shapes.size, 4);
});

test('ACCIDENTAL_PATHS: sharp, flat and natural each have a distinct path', () => {
  for (const key of ['#', 'b', '']) {
    assertValidPathData(ACCIDENTAL_PATHS[key], `accidental ${JSON.stringify(key)}`);
  }
  assert.equal(new Set(Object.values(ACCIDENTAL_PATHS)).size, 3);
});

test('REST_PATHS: every duration layout.js can emit (whole down to 32nd) has its own path', () => {
  const bases = [4, 2, 1, 0.5, 0.25, 0.125];
  for (const base of bases) {
    assertValidPathData(REST_PATHS[base], `rest ${base}`);
  }
  assert.equal(new Set(bases.map((b) => REST_PATHS[b])).size, bases.length, 'two rest lengths share a symbol');
});

test('FILLED_RESTS: only the whole and half rest are solid blocks', () => {
  assert.ok(FILLED_RESTS.has(4));
  assert.ok(FILLED_RESTS.has(2));
  assert.ok(!FILLED_RESTS.has(1));
  assert.ok(!FILLED_RESTS.has(0.5));
});
