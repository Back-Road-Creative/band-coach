import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawPrimitives } from '../../../src/notation/draw-canvas.js';
import { layoutMeasure } from '../../../src/notation/layout.js';

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

test('drawPrimitives: a clef falls back to a plain letter when no glyph font is set', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'clef', x: 0, y: 0, clef: 'treble' }], { glyphFont: null });
  const textCall = ctx.calls.find((c) => c[0] === 'fillText');
  assert.ok(textCall);
  assert.equal(textCall[1], 'G'); // plain-text fallback for a treble (G) clef
});

test('drawPrimitives: a clef uses the music glyph when a glyph font is provided', () => {
  const ctx = makeFakeCtx();
  drawPrimitives(ctx, [{ type: 'clef', x: 0, y: 0, clef: 'bass' }], { glyphFont: '"Noto Music"' });
  const textCall = ctx.calls.find((c) => c[0] === 'fillText');
  assert.equal(textCall[1], '\u{1D122}');
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
