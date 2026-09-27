import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawPrimitives } from '../../../src/notation/draw-canvas.js';
import { layoutMeasure } from '../../../src/notation/layout.js';
import { CLEF_PATHS } from '../../../src/notation/glyphs.js';

// A recording fake ctx: every method call and property assignment is logged
// in call order, so the drawer can be pinned as a call sequence.
function makeFakeCtx() {
  const calls = [];
  const methods = ['beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'ellipse', 'save', 'restore', 'fillText', 'translate', 'rotate'];
  const ctx = { calls, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '' };
  for (const m of methods) {
    ctx[m] = (...args) => calls.push([m, ...args]);
  }
  return ctx;
}

// Real browsers all provide Path2D; Node's test environment does not, so this stands in
// for it -- just enough of the interface (a constructor that records the path-data string
// it was built from) for drawGlyphPath()'s `new Path2D(d)` / ctx.fill(path) / ctx.stroke(path)
// calls to work the way they would in a browser.
class FakePath2D {
  constructor(d) { this.d = d; }
}

test('drawPrimitives: draws a line primitive as a stroked path', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'line', x: 5, y: 10, length: 50 }], {});
  const names = ctx.calls.map((c) => c[0]);
  assert.deepEqual(names, ['beginPath', 'moveTo', 'lineTo', 'stroke']);
  assert.deepEqual(ctx.calls[1], ['moveTo', 5, 10]);
  assert.deepEqual(ctx.calls[2], ['lineTo', 55, 10]);
});

test('drawPrimitives: draws a notehead as an ellipse, filled or hollow', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'notehead', x: 0, y: 0, filled: true }], {});
  assert.ok(ctx.calls.some((c) => c[0] === 'ellipse'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fill'));
});

test('drawPrimitives: draws a hollow notehead without filling', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'notehead', x: 0, y: 0, filled: false }], {});
  assert.ok(ctx.calls.some((c) => c[0] === 'ellipse'));
  assert.ok(!ctx.calls.some((c) => c[0] === 'fill'));
  assert.ok(ctx.calls.some((c) => c[0] === 'stroke'));
});

// Spec change: a clef with no glyph font, on a real browser (Path2D available), now draws
// as a vector path -- not the plain-letter fallback. The letter is now a last-resort
// fallback for the rare no-Path2D environment (see the next test).
test('drawPrimitives: a clef draws its vector path when no glyph font is set (Path2D available)', () => {
  const previousPath2D = globalThis.Path2D;
  globalThis.Path2D = FakePath2D;
  try {
    const ctx = makeFakeCtx();
    drawPrimitives(ctx, [{ type: 'clef', x: 3, y: 7, clef: 'treble' }], { glyphFont: null });
    assert.ok(ctx.calls.some((c) => c[0] === 'translate' && c[1] === 3 && c[2] === 7), 'must translate to the clef anchor');
    const strokeCall = ctx.calls.find((c) => c[0] === 'stroke');
    assert.ok(strokeCall, 'clef path is stroked, not filled');
    assert.ok(strokeCall[1] instanceof FakePath2D);
    assert.equal(strokeCall[1].d, CLEF_PATHS.treble);
    assert.ok(!ctx.calls.some((c) => c[0] === 'fillText'), 'must not fall back to a letter when a vector path is available');
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});

test('drawPrimitives: a clef falls back to a plain letter when Path2D is unavailable', () => {
  const previousPath2D = globalThis.Path2D;
  delete globalThis.Path2D;
  try {
    const ctx = makeFakeCtx();
    drawPrimitives(ctx, [{ type: 'clef', x: 0, y: 0, clef: 'treble' }], { glyphFont: null });
    const textCall = ctx.calls.find((c) => c[0] === 'fillText');
    assert.ok(textCall);
    assert.equal(textCall[1], 'G'); // plain-text fallback for a treble (G) clef
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});

test('drawPrimitives: a clef uses the music glyph when a glyph font is provided', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'clef', x: 0, y: 0, clef: 'bass' }], { glyphFont: '"Noto Music"' });
  const textCall = ctx.calls.find((c) => c[0] === 'fillText');
  assert.equal(textCall[1], '\u{1D122}');
});

test('drawPrimitives: an accidental draws its vector path (stroked, not filled)', () => {
  const previousPath2D = globalThis.Path2D;
  globalThis.Path2D = FakePath2D;
  try {
    const ctx = makeFakeCtx();
    drawPrimitives(ctx, [{ type: 'accidental', x: 0, y: 0, accidental: '#' }], {});
    const strokeCall = ctx.calls.find((c) => c[0] === 'stroke');
    assert.ok(strokeCall && strokeCall[1] instanceof FakePath2D);
    assert.ok(!ctx.calls.some((c) => c[0] === 'fillText'));
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});

test('drawPrimitives: a whole rest draws a filled vector path; a quarter rest draws a stroked one', () => {
  const previousPath2D = globalThis.Path2D;
  globalThis.Path2D = FakePath2D;
  try {
    const wholeCtx = makeFakeCtx();
    drawPrimitives(wholeCtx, [{ type: 'rest', x: 0, y: 0, base: 4 }], {});
    assert.ok(wholeCtx.calls.find((c) => c[0] === 'fill' && c[1] instanceof FakePath2D), 'whole rest must be filled');
    assert.ok(!wholeCtx.calls.some((c) => c[0] === 'stroke'));

    const quarterCtx = makeFakeCtx();
    drawPrimitives(quarterCtx, [{ type: 'rest', x: 0, y: 0, base: 1 }], {});
    assert.ok(quarterCtx.calls.find((c) => c[0] === 'stroke' && c[1] instanceof FakePath2D), 'quarter rest must be stroked');
    assert.ok(!quarterCtx.calls.some((c) => c[0] === 'fill'));
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});

test('drawPrimitives: draws every primitive of a real measure without throwing', () => {
  const ctx = makeFakeCtx();
  const { primitives } = layoutMeasure({
    clef: 'grand', key: 'D', time: [4, 4], width: 400,
    notes: [{ midi: 61, dur: 1 }, { midi: null, dur: 1 }, { midi: 72, dur: 2 }],
  });
  assert.doesNotThrow(() => drawPrimitives(ctx, primitives, {}));
  assert.ok(ctx.calls.length > primitives.length, 'each primitive draws with more than one call on average');
});

test('drawPrimitives: draws every primitive of a real measure without throwing (Path2D available)', () => {
  const previousPath2D = globalThis.Path2D;
  globalThis.Path2D = FakePath2D;
  try {
    const ctx = makeFakeCtx();
    const { primitives } = layoutMeasure({
      clef: 'grand', key: 'D', time: [4, 4], width: 400,
      notes: [{ midi: 61, dur: 1 }, { midi: null, dur: 1 }, { midi: 72, dur: 2 }],
    });
    assert.doesNotThrow(() => drawPrimitives(ctx, primitives, {}));
    assert.ok(ctx.calls.length > primitives.length, 'each primitive draws with more than one call on average');
  } finally {
    globalThis.Path2D = previousPath2D;
  }
});
