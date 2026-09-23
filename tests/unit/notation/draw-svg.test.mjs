import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSVG, escapeXML } from '../../../src/notation/draw-svg.js';
import { layoutMeasure } from '../../../src/notation/layout.js';

// Every primitive type draw-canvas.js's DRAWERS table handles (src/notation/draw-canvas.js).
// Kept here as an explicit parity list -- DRAWERS itself isn't exported, so a new primitive
// type added to draw-canvas.js without a matching entry here is a silent SVG-rendering gap
// rather than a caught one; anyone adding a type to DRAWERS should add it to this list too.
const CANVAS_PRIMITIVE_TYPES = [
  'line', 'ledger', 'barline', 'stem', 'notehead', 'dot',
  'clef', 'keyAccidental', 'accidental', 'timeSig', 'rest', 'flag', 'beam', 'fretNumber',
];

// A minimal well-formedness checker: no external XML parser is available (no npm runtime
// deps, no DOM in this test environment), so this walks tags with a stack and rejects
// unescaped '<'/'&' in text content and mismatched/unclosed tags.
function assertWellFormedXML(svg) {
  assert.ok(svg.trim().length > 0, 'svg output must not be empty');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let lastIndex = 0;
  let m;
  while ((m = tagRe.exec(svg))) {
    const between = svg.slice(lastIndex, m.index);
    assert.ok(!/[<&](?!amp;|lt;|gt;|quot;|apos;|#)/.test(between), `unescaped '<' or '&' in text: ${JSON.stringify(between)}`);
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      assert.equal(open, name, `mismatched closing tag </${name}>, expected </${open}>`);
    } else if (!selfClosing) {
      stack.push(name);
    }
    lastIndex = tagRe.lastIndex;
  }
  assert.equal(stack.length, 0, `unclosed tags: ${stack.join(', ')}`);
}

test('drawSVG: renders a recognizable SVG document', () => {
  const svg = drawSVG([{ type: 'line', x: 5, y: 10, length: 50 }], {}, { width: 100, height: 100 });
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /<\/svg>\s*$/);
  assertWellFormedXML(svg);
});

test('drawSVG: output is well-formed XML for every primitive type draw-canvas.js knows', () => {
  const samplesByType = {
    line: { type: 'line', x: 5, y: 10, length: 50 },
    ledger: { type: 'ledger', x: 20, y: 15, length: 20 },
    barline: { type: 'barline', x: 30, y1: 0, y2: 40 },
    stem: { type: 'stem', x: 12, y1: 0, y2: 35 },
    notehead: { type: 'notehead', x: 10, y: 10, filled: true },
    dot: { type: 'dot', x: 14, y: 10 },
    clef: { type: 'clef', x: 0, y: 20, clef: 'treble' },
    keyAccidental: { type: 'keyAccidental', x: 8, y: 20, accidental: '#' },
    accidental: { type: 'accidental', x: 8, y: 20, accidental: 'b' },
    timeSig: { type: 'timeSig', x: 16, y: 20, top: 4, bottom: 4 },
    rest: { type: 'rest', x: 24, y: 20 },
    flag: { type: 'flag', x: 12, y: 0, up: true },
    beam: { type: 'beam', x1: 0, y1: 0, x2: 20, y2: 5 },
    fretNumber: { type: 'fretNumber', x: 5, fret: 3, string: 2 },
  };
  assert.deepEqual(Object.keys(samplesByType).sort(), [...CANVAS_PRIMITIVE_TYPES].sort(), 'sample set must match the full draw-canvas primitive list');
  for (const type of CANVAS_PRIMITIVE_TYPES) {
    const svg = drawSVG([samplesByType[type]], { glyphFont: '"Noto Music"' }, { width: 200, height: 200 });
    assertWellFormedXML(svg);
  }
});

test('drawSVG: escapes text content (accidental/rest glyph fallback and clef letters)', () => {
  const svg = drawSVG([
    { type: 'clef', x: 0, y: 0, clef: 'treble' },
    { type: 'accidental', x: 0, y: 0, accidental: '#' },
  ], { glyphFont: null }, { width: 50, height: 50 });
  assertWellFormedXML(svg);
  assert.match(svg, />G</); // plain-letter fallback for treble clef, unescaped in output text
  assert.match(svg, />#</); // '#' has no special XML meaning and needs no escaping
});

test('escapeXML: escapes the five XML special characters', () => {
  assert.equal(escapeXML('<a & b> "c\' d"'), '&lt;a &amp; b&gt; &quot;c&apos; d&quot;');
});

test('drawSVG: uses the same geometry as draw-canvas.js for a line primitive', () => {
  const svg = drawSVG([{ type: 'line', x: 5, y: 10, length: 50 }], {}, { width: 100, height: 100 });
  assert.match(svg, /x1="5"[^>]*y1="10"[^>]*x2="55"[^>]*y2="10"/);
});

test('drawSVG: a whole rest and an eighth rest render different glyphs, with and without a glyph font', () => {
  const wholeRest = { type: 'rest', x: 0, y: 0, base: 4 };
  const eighthRest = { type: 'rest', x: 0, y: 0, base: 0.5 };

  const glyphSvgWhole = drawSVG([wholeRest], { glyphFont: '"Noto Music"' }, { width: 50, height: 50 });
  const glyphSvgEighth = drawSVG([eighthRest], { glyphFont: '"Noto Music"' }, { width: 50, height: 50 });
  assert.notEqual(glyphSvgWhole, glyphSvgEighth);

  const fallbackSvgWhole = drawSVG([wholeRest], { glyphFont: null }, { width: 50, height: 50 });
  const fallbackSvgEighth = drawSVG([eighthRest], { glyphFont: null }, { width: 50, height: 50 });
  assert.notEqual(fallbackSvgWhole, fallbackSvgEighth);
});

test('drawSVG: every rest length layout.js can emit (whole down to 32nd) gets its own symbol', () => {
  const bases = [4, 2, 1, 0.5, 0.25, 0.125];
  for (const glyphFont of ['"Noto Music"', null]) {
    const drawn = bases.map((base) => drawSVG([{ type: 'rest', x: 0, y: 0, base }], { glyphFont }, { width: 50, height: 50 }));
    assert.equal(new Set(drawn).size, bases.length, `glyphFont=${glyphFont}: two rest lengths share a symbol`);
  }
});

test('drawSVG: draws every primitive of a real measure without throwing, well-formed output', () => {
  const { primitives } = layoutMeasure({
    clef: 'grand', key: 'D', time: [4, 4], width: 400,
    notes: [{ midi: 61, dur: 1 }, { midi: null, dur: 1 }, { midi: 72, dur: 2 }],
  });
  const svg = drawSVG(primitives, {}, { width: 400, height: 200 });
  assertWellFormedXML(svg);
  assert.ok(svg.length > 100);
});
