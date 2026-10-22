// src/instruments/how/drum-kit.js: the drawn kit, seen from the throne. Every
// piece in the drum-kit record gets one region inside the KIT_ASPECT x 1 frame,
// regions do not pile on top of each other (the open-hi-hat tab sits on the
// hi-hat disc by design), the shapes tell drums from cymbals from pedals, a
// click in pixels finds the piece, and every piece has a plain-words sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kitLayout, describeHit, pieceAt, kitRegions, kitFrame, KIT_ASPECT } from '../../src/instruments/how/drum-kit.js';
import { PIECES } from '../../src/instruments/drum-kit.js';

const SHAPES = { kick: 'pedal', snare: 'drum', 'hihat-closed': 'cymbal', 'hihat-open': 'tab', 'hihat-pedal': 'pedal', 'tom-high': 'drum', 'tom-mid': 'drum', 'tom-floor': 'drum', crash: 'cymbal', ride: 'cymbal' };
const at = () => Object.fromEntries(kitLayout().map(p => [p.id, p]));
const isRect = p => p.shape === 'pedal' || p.shape === 'tab';
const bounds = p => isRect(p) ? { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - p.h / 2, y1: p.y + p.h / 2 } : { x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r };
// distance between two regions' shapes (0 when they touch or overlap); circles exactly, rects by their edges
function gap(a, b) {
  if (!isRect(a) && !isRect(b)) return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  const near = (rect, c) => ({ x: Math.max(rect.x - rect.w / 2, Math.min(c.x, rect.x + rect.w / 2)), y: Math.max(rect.y - rect.h / 2, Math.min(c.y, rect.y + rect.h / 2)) });
  if (isRect(a) && isRect(b)) { const A = bounds(a), B = bounds(b); return Math.max(A.x0 - B.x1, B.x0 - A.x1, A.y0 - B.y1, B.y0 - A.y1); }
  const [rect, circ] = isRect(a) ? [a, b] : [b, a], q = near(rect, circ);
  return Math.hypot(q.x - circ.x, q.y - circ.y) - circ.r;
}

test('kitLayout places every kit piece exactly once, fully inside the KIT_ASPECT x 1 frame, with the right shapes', () => {
  const layout = kitLayout();
  assert.equal(layout.length, 10);
  assert.deepEqual(layout.map(p => p.id).sort(), PIECES.map(p => p.id).sort());
  assert.deepEqual(Object.fromEntries(layout.map(p => [p.id, p.shape])), SHAPES);
  for (const p of layout) {
    const b = bounds(p);
    assert.ok(isRect(p) ? p.w > 0 && p.h > 0 : p.r > 0, p.id + ' size');
    assert.ok(b.x0 >= 0 && b.x1 <= KIT_ASPECT && b.y0 >= 0 && b.y1 <= 1, p.id + ' is outside the frame');
    assert.equal(p.name, PIECES.find(q => q.id === p.id).name);
  }
});

test('no two regions touch, except the open-hi-hat tab sitting on the closed hi-hat disc', () => {
  const layout = kitLayout();
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i], b = layout[j], pair = [a.id, b.id].sort().join('+');
      const g = gap(a, b);
      if (pair === 'hihat-closed+hihat-open') assert.ok(g < 0, 'the tab overlaps the disc');
      else assert.ok(g > 0, a.id + ' and ' + b.id + ' touch (gap ' + g.toFixed(3) + ')');
    }
  }
  const p = at(), tab = bounds(p['hihat-open']);
  assert.ok(p['hihat-closed'].y - p['hihat-closed'].r - tab.y1 > -0.25 * p['hihat-closed'].r, 'the tab reaches less than a quarter radius into the disc');
});

test('the kit reads like a real kit from the throne', () => {
  const p = at(), mid = KIT_ASPECT / 2;
  const drums = ['snare', 'tom-high', 'tom-mid', 'tom-floor'];
  for (const d of drums) if (d !== 'snare') assert.ok(p.snare.r > p[d].r, 'the snare is the largest drum, not ' + d);
  assert.equal(p['tom-high'].y, p['tom-mid'].y);
  assert.ok(p['tom-high'].x < p['tom-mid'].x);
  for (const t of ['tom-high', 'tom-mid']) assert.ok(Math.abs(p[t].x - mid) < 0.15 * KIT_ASPECT, t + ' centre-back');
  const tg = gap(p['tom-high'], p['tom-mid']);
  assert.ok(tg > 0 && tg < Math.min(p['tom-high'].r, p['tom-mid'].r), 'the toms sit side by side: gap ' + tg);
  assert.equal(p['tom-floor'].y, p.snare.y);
  assert.ok(p['tom-floor'].x > mid);
  assert.ok(p.snare.x < mid, 'snare front-left');
  const hh = p['hihat-closed'];
  for (const id of ['snare', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride']) assert.ok(hh.x < p[id].x, 'hi-hat is further left than ' + id);
  assert.ok(p['hihat-pedal'].y > hh.y && Math.abs(p['hihat-pedal'].x - hh.x) < hh.r, 'hi-hat pedal under the hi-hat');
  assert.ok(p.crash.y < hh.y && p.crash.x > hh.x, 'crash behind and right of the hi-hat');
  for (const id of Object.keys(p)) if (id !== 'ride') assert.ok(p.ride.x > p[id].x, 'ride is the furthest right, not ' + id);
  assert.ok(p.ride.y < p['tom-floor'].y);
  assert.ok(Math.abs(p.kick.x - mid) < 0.02, 'kick centred');
  const bottom = q => bounds(q).y1;
  for (const id of Object.keys(p)) if (id !== 'kick') assert.ok(bottom(p.kick) >= bottom(p[id]), 'kick is the lowest, not ' + id);
  for (const pedal of ['kick', 'hihat-pedal']) for (const id of ['snare', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride', 'hihat-closed']) assert.ok(bottom(p[pedal]) > p[id].y, pedal + ' bottom is below the ' + id + ' centre');
  assert.ok(p['hihat-open'].y < hh.y && Math.abs(p['hihat-open'].x - hh.x) < hh.r, 'the open tab is on the hi-hat far edge');
});

test('kitLayout hands back a fresh copy each call', () => {
  const a = kitLayout();
  a[0].x = 99;
  assert.notEqual(kitLayout()[0].x, 99);
});

test('describeHit gives a plain sentence for every piece and null for anything else', () => {
  for (const p of PIECES) {
    const text = describeHit(p.id);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 20, p.id + ': ' + text);
    assert.ok(/\.$/.test(text), p.id + ' ends as a sentence');
  }
  assert.match(describeHit('kick'), /foot/);
  assert.match(describeHit('hihat-pedal'), /left foot/);
  assert.equal(describeHit('cowbell'), null);
  assert.equal(describeHit(undefined), null);
});

// boxes built by drawKit's own formula: idle 0.94W x 0.9H centred, in a bar 0.94W x 0.62H at 0.37H
const boxOf = (W, H, bar) => { const w = W * 0.94, h = bar ? H * 0.62 : H * 0.9; return { x: (W - w) / 2, y: bar ? H * 0.37 : (H - h) / 2, w, h }; };
const SIZES = [[1280, 800], [1024, 640], [360, 277], [1170, 899]];

test('kitFrame keeps the kit its shape: the frame is KIT_ASPECT wide per unit of height and centred in its box', () => {
  for (const [W, H] of SIZES) for (const bar of [false, true]) {
    const box = boxOf(W, H, bar), f = kitFrame(box);
    assert.ok(Math.abs(f.w / f.h - KIT_ASPECT) < 1e-9);
    assert.ok(f.x >= box.x - 1e-9 && f.x + f.w <= box.x + box.w + 1e-9 && f.y >= box.y - 1e-9 && f.y + f.h <= box.y + box.h + 1e-9);
    assert.ok(Math.abs(f.x + f.w / 2 - (box.x + box.w / 2)) < 1e-9 && Math.abs(f.y + f.h / 2 - (box.y + box.h / 2)) < 1e-9);
    assert.ok(Math.abs(f.h - Math.min(box.h, box.w / KIT_ASPECT)) < 1e-9, 'as tall as the box lets it be');
  }
});

test('kitRegions and pieceAt hit in pixels: each piece at its centre, circles to 0.9 of their radius and not beyond 1.1', () => {
  for (const [W, H] of SIZES) for (const bar of [false, true]) {
    const box = boxOf(W, H, bar), regs = kitRegions(box), f = kitFrame(box);
    const where = `${W}x${H}${bar ? ' bar' : ''}`;
    assert.equal(regs.length, 10);
    assert.equal(new Set(regs.map(r => r.id)).size, 10, 'distinct ids');
    for (const r of regs) {
      assert.ok(['circle', 'rect'].includes(r.kind));
      assert.ok(r.cx >= f.x && r.cx <= f.x + f.w && r.cy >= f.y && r.cy <= f.y + f.h, r.id + ' centre in the frame');
      if (r.kind === 'circle') {
        // a click on the disc's centre: the closed hi-hat's centre is clear of the tab
        assert.equal(pieceAt(r.cx, r.cy, box), r.id, where + ' ' + r.id + ' centre');
        assert.equal(pieceAt(r.cx + 0.9 * r.r, r.cy, box), r.id, where + ' ' + r.id + ' 0.9 east');
        assert.equal(pieceAt(r.cx, r.cy + 0.9 * r.r, box), r.id, where + ' ' + r.id + ' 0.9 south');
        // 1.1 of the radius out reaches nothing, in every compass direction where no OTHER piece is that close
        const inside = (q, x, y) => q.kind === 'circle' ? Math.hypot(x - q.cx, y - q.cy) <= q.r : x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
        let free = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = r.cx + dx * 1.1 * r.r, y = r.cy + dy * 1.1 * r.r;
          if (regs.some(q => q !== r && inside(q, x, y))) continue;
          free++;
          assert.equal(pieceAt(x, y, box), null, where + ' ' + r.id + ' 1.1 out at ' + dx + ',' + dy);
        }
        assert.ok(free >= 2, where + ' ' + r.id + ' has open space just outside it in at least two directions');
      } else {
        assert.equal(pieceAt(r.cx, r.cy, box), r.id, where + ' ' + r.id + ' centre');
        assert.equal(pieceAt(r.x + 1, r.y + 1, box), r.id, where + ' ' + r.id + ' inside corner');
        assert.equal(pieceAt(r.x + r.w + 1, r.cy, box) === r.id, false, where + ' ' + r.id + ' just outside');
      }
    }
    assert.equal(pieceAt(box.x + 1, box.y + 1, box), null, 'box corner');
    assert.equal(pieceAt(box.x + box.w - 1, box.y + box.h - 1, box), null, 'box corner');
    assert.equal(pieceAt(NaN, box.y + box.h / 2, box), null);
    assert.equal(pieceAt(box.x + box.w / 2, NaN, box), null);
  }
});

test('the tab is on top: a click on it plays the open hi-hat, the rest of the disc the closed one', () => {
  const box = boxOf(1280, 800, false), regs = Object.fromEntries(kitRegions(box).map(r => [r.id, r]));
  assert.equal(pieceAt(regs['hihat-open'].cx, regs['hihat-open'].cy, box), 'hihat-open');
  assert.equal(pieceAt(regs['hihat-closed'].cx, regs['hihat-closed'].cy, box), 'hihat-closed');
  assert.equal(pieceAt(regs['hihat-pedal'].cx, regs['hihat-pedal'].cy, box), 'hihat-pedal');
});
