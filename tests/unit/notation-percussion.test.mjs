import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffPosition, ledgerLines } from '../../src/notation/staff.js';
import { layoutMeasure } from '../../src/notation/layout.js';
import { drawSVG } from '../../src/notation/draw-svg.js';
import { drawPrimitives } from '../../src/notation/draw-canvas.js';
import { PERCUSSION_SLOTS, PIECE_IDS, percussionNote, layoutPercussionMeasure } from '../../src/notation/percussion.js';

function byType(primitives, type) {
  return primitives.filter((p) => p.type === type);
}

// A recording fake ctx matching tests/unit/notation/draw-canvas.test.mjs's pattern.
function makeFakeCtx() {
  const calls = [];
  const methods = ['beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'ellipse', 'save', 'restore', 'fillText', 'translate', 'rotate'];
  const ctx = { calls, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '' };
  for (const m of methods) ctx[m] = (...args) => calls.push([m, ...args]);
  return ctx;
}

test('staffPosition: works for a percussion slot without throwing', () => {
  assert.equal(staffPosition(PERCUSSION_SLOTS.snare, 'percussion'), 5);
  assert.equal(staffPosition({ position: -3 }, 'percussion'), -3);
});

test('every drum-kit piece id in the contract has a slot', () => {
  for (const id of PIECE_IDS) {
    assert.ok(PERCUSSION_SLOTS[id], `missing slot for ${id}`);
  }
  assert.equal(PIECE_IDS.length, 10);
});

test('slots are unique except closed/open hi-hat sharing one', () => {
  const positions = {};
  for (const [id, slot] of Object.entries(PERCUSSION_SLOTS)) {
    if (!positions[slot.position]) positions[slot.position] = [];
    positions[slot.position].push(id);
  }
  const shared = Object.values(positions).filter((ids) => ids.length > 1);
  assert.equal(shared.length, 1, 'exactly one staff position should be shared');
  assert.deepEqual(shared[0].sort(), ['hihat-closed', 'hihat-open']);
});

test('stem direction: down only for kick and hihat-pedal, up for everything else', () => {
  for (const [id, slot] of Object.entries(PERCUSSION_SLOTS)) {
    const expected = id === 'kick' || id === 'hihat-pedal' ? 'down' : 'up';
    assert.equal(slot.stem, expected, `${id} stem`);
  }
});

test('noteheads: hi-hat/ride/crash are x-shaped, kick/snare/toms are ovals', () => {
  const xShaped = ['hihat-closed', 'hihat-open', 'ride', 'crash'];
  const ovalShaped = ['kick', 'snare', 'tom-floor', 'tom-mid', 'tom-high', 'hihat-pedal'];
  for (const id of xShaped) assert.equal(PERCUSSION_SLOTS[id].notehead, 'x', id);
  for (const id of ovalShaped) assert.equal(PERCUSSION_SLOTS[id].notehead, 'oval', id);
});

test('percussionNote: produces a layoutMeasure-shaped note with a single hit', () => {
  const note = percussionNote('snare', 1);
  assert.equal(note.midi, null);
  assert.equal(note.dur, 1);
  assert.equal(note.perc.hits.length, 1);
  assert.equal(note.perc.hits[0].piece, 'snare');
  assert.equal(note.perc.stem, 'up');
});

test('percussionNote: throws on an unknown piece id', () => {
  assert.throws(() => percussionNote('cowbell', 1));
});

test('layoutMeasure: clef "percussion" draws a percussion clef and no key signature', () => {
  const { primitives } = layoutMeasure({
    clef: 'percussion', key: 'D', time: [4, 4], width: 400,
    notes: [percussionNote('snare', 4)],
  });
  const clefs = byType(primitives, 'clef');
  assert.equal(clefs.length, 1);
  assert.equal(clefs[0].clef, 'percussion');
  assert.equal(byType(primitives, 'keyAccidental').length, 0, 'percussion has no key signature');
});

test('layoutMeasure: a percussion hit gets a notehead with the right shape and no accidental machinery', () => {
  const { primitives } = layoutMeasure({
    clef: 'percussion', key: 'C', time: [4, 4], width: 400,
    notes: [percussionNote('ride', 4)],
  });
  const heads = byType(primitives, 'notehead');
  assert.equal(heads.length, 1);
  assert.equal(heads[0].shape, 'x');
  assert.equal(byType(primitives, 'accidental').length, 0);
});

test('layoutMeasure: hihat-open gets an extra small circle mark above its x notehead', () => {
  const { primitives } = layoutMeasure({
    clef: 'percussion', key: 'C', time: [4, 4], width: 400,
    notes: [percussionNote('hihat-open', 4)],
  });
  const heads = byType(primitives, 'notehead');
  assert.equal(heads.length, 2);
  assert.deepEqual(heads.map((h) => h.shape).sort(), ['circle', 'x']);
});

test('layoutMeasure: crash sits on its documented ledger line above the staff', () => {
  const { primitives } = layoutMeasure({
    clef: 'percussion', key: 'C', time: [4, 4], width: 400,
    notes: [percussionNote('crash', 4)],
  });
  assert.equal(byType(primitives, 'ledger').length, 1);
});

test('layoutMeasure: kick stem points down, snare stem points up', () => {
  const { primitives } = layoutMeasure({
    clef: 'percussion', key: 'C', time: [4, 4], width: 400,
    notes: [percussionNote('kick', 2), percussionNote('snare', 2)],
  });
  const stems = byType(primitives, 'stem');
  assert.equal(stems.length, 2);
  assert.ok(stems[0].y2 > stems[0].y1, 'kick stem points down');
  assert.ok(stems[1].y2 < stems[1].y1, 'snare stem points up');
});

// A one-bar 4/4 rock beat: closed hi-hat on every eighth note, kick on beats
// 1 and 3, snare on beats 2 and 4 (all in the 0-indexed quarter-beat units
// layoutMeasure's `dur` already uses -- 1 beat == 1 quarter note).
function rockBeatHits() {
  const hits = [];
  for (let i = 0; i < 8; i++) hits.push({ piece: 'hihat-closed', start: i * 0.5, duration: 0.5 });
  hits.push({ piece: 'kick', start: 0, duration: 1 });
  hits.push({ piece: 'kick', start: 2, duration: 1 });
  hits.push({ piece: 'snare', start: 1, duration: 1 });
  hits.push({ piece: 'snare', start: 3, duration: 1 });
  return hits;
}

test('layoutPercussionMeasure: a rock beat yields the right notehead count and shapes', () => {
  const { primitives } = layoutPercussionMeasure({ hits: rockBeatHits(), time: [4, 4], width: 400 });
  const heads = byType(primitives, 'notehead');
  // 8 hi-hat + 2 kick + 2 snare = 12 noteheads total.
  assert.equal(heads.length, 12);
  const xHeads = heads.filter((h) => h.shape === 'x');
  const ovalHeads = heads.filter((h) => h.shape === 'oval');
  assert.equal(xHeads.length, 8, 'one x notehead per eighth-note hi-hat');
  assert.equal(ovalHeads.length, 4, 'one oval notehead per kick/snare hit');
});

test('layoutPercussionMeasure: stacked hits (kick+hi-hat, snare+hi-hat) share one x position', () => {
  const { primitives } = layoutPercussionMeasure({ hits: rockBeatHits(), time: [4, 4], width: 400 });
  const heads = byType(primitives, 'notehead');
  const xs = new Set(heads.map((h) => h.x));
  // 8 distinct onsets (every eighth note) -> 8 distinct x positions, even
  // though 4 of those onsets carry 2 stacked noteheads each.
  assert.equal(xs.size, 8);
  const stems = byType(primitives, 'stem');
  assert.equal(stems.length, 8, 'one shared stem per onset, including chords');
});

test('drawSVG: a percussion measure renders the percussion clef and an x-notehead primitive', () => {
  const { primitives } = layoutPercussionMeasure({ hits: rockBeatHits(), time: [4, 4], width: 400 });
  const svg = drawSVG(primitives, { glyphFont: null }, { width: 400, height: 200 });
  assert.match(svg, /\|\|/, 'plain-text percussion clef fallback');
  assert.match(svg, /<line x1="-?\d+(\.\d+)?" y1="-?\d+(\.\d+)?" x2="-?\d+(\.\d+)?" y2="-?\d+(\.\d+)?" stroke="black"\/><line/, 'an x notehead draws as two crossed strokes');
});

test('drawPrimitives: draws a full percussion measure against a stub 2D context without throwing', () => {
  const ctx = makeFakeCtx();
  const { primitives } = layoutPercussionMeasure({ hits: rockBeatHits(), time: [4, 4], width: 400 });
  assert.doesNotThrow(() => drawPrimitives(ctx, primitives, {}));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText'), 'clef falls back to fillText without a glyph font');
});

test('ledgerLines composes with staffPosition for a percussion slot', () => {
  const position = staffPosition(PERCUSSION_SLOTS.crash, 'percussion');
  assert.deepEqual(ledgerLines(position), [10]);
});
