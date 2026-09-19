import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale, majorScale, naturalMinorScale, scaleOnInstrument } from '../../src/core/theory/scales.js';
import { findKey } from '../../src/core/theory/keys.js';
import { byId } from '../../src/instruments/index.js';

function names(built) {
  return built.degrees.map(d => d.letter + d.accidental);
}

test('C major: no accidentals, every letter once', () => {
  const built = majorScale(findKey('C'));
  assert.deepEqual(names(built), ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
});

test('F# major: E# not F, every letter used exactly once', () => {
  const built = majorScale(findKey('F#'));
  assert.deepEqual(names(built), ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  assert.equal(new Set(built.degrees.map(d => d.letter)).size, 7);
});

test('Cb major: every letter flatted, including Fb and Cb again at the octave root', () => {
  const built = majorScale(findKey('Cb'));
  assert.deepEqual(names(built), ['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb']);
});

test('G# natural minor: every letter once, sharps only', () => {
  const built = naturalMinorScale(findKey('G#m'));
  assert.deepEqual(names(built), ['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F#']);
});

test('heptatonic scales use 7 distinct letters; every pattern starts on the tonic pitch class', () => {
  const heptatonic = ['major', 'natural_minor', 'harmonic_minor', 'melodic_minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'];
  for (const type of heptatonic) {
    assert.equal(new Set(scale('D', type).degrees.map(d => d.letter)).size, 7, type);
  }
  for (const type of [...heptatonic, 'major_pentatonic', 'minor_pentatonic', 'blues']) {
    assert.equal(scale('C', type).degrees[0].pc, 0, type);
  }
});

test('scaleOnInstrument: guitar (fretted, has tuning) returns fret/string positions in range', () => {
  const built = majorScale(findKey('C'));
  const notes = scaleOnInstrument(built, byId.gtr, { maxFret: 12 });
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.ok(n.midi >= byId.gtr.range.low && n.midi <= byId.gtr.range.high);
    assert.equal(byId.gtr.tuning[n.string] + n.fret, n.midi);
    assert.ok(built.degrees.some(d => d.pc === (n.midi % 12)));
  }
  // The open low E string (midi 40, pc 4 = E) is in C major.
  assert.ok(notes.some(n => n.string === 0 && n.fret === 0));
});

test('scaleOnInstrument: an instrument with no tuning (e.g. harmonica) falls back to plain midi', () => {
  const built = majorScale(findKey('C'));
  const notes = scaleOnInstrument(built, byId.harp);
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.equal(n.string, undefined);
    assert.ok(n.midi >= byId.harp.range.low && n.midi <= byId.harp.range.high);
  }
});
