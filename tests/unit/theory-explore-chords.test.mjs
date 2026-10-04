// Explore > Chord: the staff must spell chord tones the way the text does (C minor
// is C Eb G, never C D# G), and chord names read as a learner expects (C7, Bb, Cm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMeasure } from '../../src/notation/layout.js';
import { keyAccidentals } from '../../src/notation/spell.js';
import { chordSymbol, EXPLORE_ROOTS, scaleKeyName } from '../../src/ui/theory/chord-label.js';

const accs = (notes) => layoutMeasure({ clef: 'treble', key: 'C', time: [4, 4], notes, width: 320 })
  .primitives.filter((p) => p.type === 'accidental').map((p) => p.accidental);

test('a note carrying its spelling draws that spelling, not the sharp default', () => {
  assert.deepEqual(accs([{ midi: 63, dur: 1 }]), ['#']);
  assert.deepEqual(accs([{ midi: 63, dur: 1, spell: { letter: 'E', accidental: 'b' } }]), ['b']);
});

test('a flat spelling sits on its own letter line, not the sharp neighbour', () => {
  const y = (n) => layoutMeasure({ clef: 'treble', key: 'C', time: [4, 4], notes: [n], width: 320 })
    .primitives.find((p) => p.type === 'notehead').y;
  assert.ok(y({ midi: 63, dur: 1, spell: { letter: 'E', accidental: 'b' } }) < y({ midi: 63, dur: 1 }));
});

test('chordSymbol names chords the usual way', () => {
  assert.equal(chordSymbol('C', '7'), 'C7');
  assert.equal(chordSymbol('Bb', 'maj'), 'Bb');
  assert.equal(chordSymbol('C', 'min'), 'Cm');
  assert.equal(chordSymbol('G', 'm7b5'), 'Gm7b5');
});

test('Explore roots offer flats where players expect them', () => {
  assert.ok(EXPLORE_ROOTS.includes('Bb') && EXPLORE_ROOTS.includes('Eb'));
  assert.ok(!EXPLORE_ROOTS.includes('A#') && !EXPLORE_ROOTS.includes('D#'));
});

test('Explore roots keep C# and G# so C#m and G#m are not forced into Db Fb Ab', () => {
  assert.ok(EXPLORE_ROOTS.includes('C#') && EXPLORE_ROOTS.includes('G#'));
});

test('every diatonic Tonic gets a key signature the staff knows, or null (drawn from its own spelling)', () => {
  for (const t of EXPLORE_ROOTS) for (const type of ['major', 'natural_minor']) {
    const k = scaleKeyName(t, type);
    assert.ok(k === null || k === 'C' || k === 'Am' || keyAccidentals(k).length > 0, t + ' ' + type);
  }
  assert.equal(scaleKeyName('C#', 'natural_minor'), 'C#m');
  assert.equal(scaleKeyName('Db', 'natural_minor'), null);
  assert.equal(scaleKeyName('C', 'dorian'), null);
});
