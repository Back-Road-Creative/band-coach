// src/instruments/how/drum-kit.js: the top-down drawn kit. Every piece in the
// drum-kit record gets a spot inside the unit square, pieces do not pile on
// top of each other, a click on a piece's centre finds that piece, and every
// piece has a plain-words sentence for screen readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kitLayout, describeHit, pieceAt } from '../../src/instruments/how/drum-kit.js';
import { PIECES } from '../../src/instruments/drum-kit.js';

test('kitLayout places every kit piece exactly once, fully inside the unit square', () => {
  const layout = kitLayout();
  assert.deepEqual(layout.map(p => p.id).sort(), PIECES.map(p => p.id).sort());
  for (const p of layout) {
    assert.ok(p.r > 0, p.id + ' radius');
    assert.ok(p.x - p.r >= 0 && p.x + p.r <= 1, p.id + ' x out of the square: ' + p.x + '±' + p.r);
    assert.ok(p.y - p.r >= 0 && p.y + p.r <= 1, p.id + ' y out of the square: ' + p.y + '±' + p.r);
    assert.ok(['drum', 'cymbal', 'pedal'].includes(p.shape), p.id + ' shape ' + p.shape);
    assert.equal(p.name, PIECES.find(q => q.id === p.id).name);
  }
});

test('no two pieces overlap by more than 20% of the smaller radius', () => {
  const layout = kitLayout();
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i];
      const b = layout[j];
      const overlap = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(overlap <= 0.2 * Math.min(a.r, b.r), a.id + ' and ' + b.id + ' overlap by ' + overlap.toFixed(3));
    }
  }
});

test('the kit reads like a real kit from the throne', () => {
  const at = Object.fromEntries(kitLayout().map(p => [p.id, p]));
  assert.ok(Math.abs(at.kick.x - 0.5) < 0.05 && at.kick.y > 0.6, 'bass drum centre bottom');
  assert.ok(at.snare.x < 0.5, 'snare left of centre');
  assert.ok(at['hihat-closed'].x < at.snare.x, 'hi-hat further left than the snare');
  assert.ok(at['tom-high'].y < at.kick.y && at['tom-mid'].y < at.kick.y, 'rack toms above the bass drum');
  assert.ok(at['tom-floor'].x > 0.5, 'floor tom on the right');
  assert.ok(at.crash.x < 0.5 && at.crash.y < 0.3, 'crash upper left');
  assert.ok(at.ride.x > 0.5 && at.ride.y < 0.3, 'ride upper right');
  assert.equal(at.crash.shape, 'cymbal');
  assert.equal(at.ride.shape, 'cymbal');
  assert.equal(at.snare.shape, 'drum');
});

test('pieceAt finds each piece at its own centre and nothing in empty space', () => {
  for (const p of kitLayout()) assert.equal(pieceAt(p.x, p.y), p.id);
  assert.equal(pieceAt(0.98, 0.98), null);
  assert.equal(pieceAt(-1, 0.5), null);
  assert.equal(pieceAt(NaN, 0.5), null);
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
