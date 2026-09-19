import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReveal, promptFor, hintFor } from '../../src/core/reveal.js';

// ---------- shouldReveal ----------

test('shouldReveal: no args (fresh item, zero exposures) reveals', () => {
  assert.equal(shouldReveal({}), true);
  assert.equal(shouldReveal(), true);
});

test('shouldReveal: exposures 0 and 1 reveal (first two exposures)', () => {
  assert.equal(shouldReveal({ exposures: 0 }), true);
  assert.equal(shouldReveal({ exposures: 1 }), true);
});

test('shouldReveal: exposures 2 and above do not reveal', () => {
  assert.equal(shouldReveal({ exposures: 2 }), false);
  assert.equal(shouldReveal({ exposures: 5 }), false);
});

test('shouldReveal: failedThisTask reveals regardless of exposures', () => {
  assert.equal(shouldReveal({ exposures: 9, failedThisTask: true }), true);
});

test('shouldReveal: revealRequested reveals regardless of exposures or failure', () => {
  assert.equal(shouldReveal({ exposures: 9, failedThisTask: false, revealRequested: true }), true);
});

test('shouldReveal: isNew treats the item as its first exposure even if exposures is stale/high', () => {
  assert.equal(shouldReveal({ exposures: 9, isNew: true }), true);
});

// ---------- promptFor ----------

test('promptFor: null item returns empty string', () => {
  assert.equal(promptFor(null, true), '');
  assert.equal(promptFor(null, false), '');
});

test('promptFor: fretted item (colon label) always shows the note-name half, revealed or not', () => {
  const item = { string: 6, fret: 3, label: 'G3: string 6, fret 3', short: 'G3 (string 6)' };
  assert.equal(promptFor(item, false), 'G3');
  assert.equal(promptFor(item, true), 'G3');
});

test('promptFor: item with no colon in its label returns the label unchanged', () => {
  const item = { label: 'C major', short: 'C' };
  assert.equal(promptFor(item, false), 'C major');
  assert.equal(promptFor(item, true), 'C major');
});

test('promptFor: item with no label falls back to short', () => {
  assert.equal(promptFor({ short: 'Do' }, false), 'Do');
});

test('promptFor: harmonica item asks for the note when not revealed', () => {
  const item = { hole: 4, dir: 'b', midi: 64, note: 'E4', label: 'Blow 4 (E4)', short: 'Blow 4' };
  assert.equal(promptFor(item, false), 'E4');
});

test('promptFor: harmonica item shows blow/draw + hole only when revealed', () => {
  const blow = { hole: 4, dir: 'b', midi: 64, note: 'E4' };
  const draw = { hole: 5, dir: 'd', midi: 67, note: 'G4' };
  assert.equal(promptFor(blow, true), 'Blow 4');
  assert.equal(promptFor(draw, true), 'Draw 5');
});

test('promptFor: harmonica item with no note falls back to short when unrevealed', () => {
  const item = { hole: 4, dir: 'b', short: 'Blow 4' };
  assert.equal(promptFor(item, false), 'Blow 4');
});

// ---------- hintFor ----------

test('hintFor: null item returns empty string', () => {
  assert.equal(hintFor(null, true), '');
});

test('hintFor: string item unrevealed never names the string or fret', () => {
  const item = { string: 6, fret: 3 };
  const hint = hintFor(item, false);
  assert.ok(!hint.includes('String'), 'must not leak the string number');
  assert.ok(!hint.includes('fret'), 'must not leak the fret number');
  assert.ok(hint.includes('mic checks'), 'still explains the mic behaviour');
});

test('hintFor: string item revealed names string and fret', () => {
  const item = { string: 6, fret: 3 };
  const hint = hintFor(item, true);
  assert.ok(hint.includes('String 6'));
  assert.ok(hint.includes('fret 3'));
  assert.ok(hint.includes('dot shows where'));
});

test('hintFor: open string (fret 0) revealed says "played open", not "fret 0"', () => {
  const item = { string: 4, fret: 0 };
  const hint = hintFor(item, true);
  assert.ok(hint.includes('played open'));
  assert.ok(!hint.includes('fret 0'));
});

test('hintFor: harmonica item unrevealed does not name the hole or direction', () => {
  const item = { hole: 4, dir: 'b' };
  const hint = hintFor(item, false);
  assert.ok(!hint.includes('4'));
  assert.ok(!/blow|draw/i.test(hint));
});

test('hintFor: harmonica item revealed names hole and direction', () => {
  const blow = hintFor({ hole: 4, dir: 'b' }, true);
  const draw = hintFor({ hole: 5, dir: 'd' }, true);
  assert.ok(blow.includes('Blow') && blow.includes('4'));
  assert.ok(draw.includes('Draw') && draw.includes('5'));
});

test('hintFor: item with no recognised kind returns empty string', () => {
  assert.equal(hintFor({ anywhere: true }, true), '');
});
