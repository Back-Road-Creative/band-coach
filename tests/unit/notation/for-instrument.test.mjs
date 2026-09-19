import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forInstrument } from '../../../src/notation/for-instrument.js';
import { byId } from '../../../src/instruments/index.js';

function byType(primitives, type) {
  return primitives.filter((p) => p.type === type);
}

test('forInstrument: null/undefined midi returns null', () => {
  assert.equal(forInstrument(byId.kbd, null), null);
  assert.equal(forInstrument(byId.kbd, undefined), null);
});

test('forInstrument: keyboard draws on a grand staff at its sounding pitch', () => {
  const out = forInstrument(byId.kbd, 60);
  assert.equal(out.clef, 'grand');
  assert.equal(out.written, 60, 'keyboard has no notation octave shift');
  assert.equal(byType(out.primitives, 'notehead').length, 1);
  assert.equal(byType(out.primitives, 'line').length, 10, 'grand staff draws 10 lines');
});

test('forInstrument: guitar is written an octave above its sounding pitch, on a treble clef', () => {
  const out = forInstrument(byId.gtr, 40); // open low E, MIDI 40
  assert.equal(out.clef, 'treble');
  assert.equal(out.written, 52, 'guitar prints an octave (12 semitones) above sounding pitch');
  assert.equal(out.spelled.octave, Math.floor(52 / 12) - 1);
});

test('forInstrument: bass is written an octave above its sounding pitch, on a bass clef', () => {
  const out = forInstrument(byId.bass, 28); // open E, MIDI 28
  assert.equal(out.clef, 'bass');
  assert.equal(out.written, 40, 'bass prints an octave above sounding pitch');
});

test('forInstrument: ukulele has no notation octave shift, treble clef', () => {
  const out = forInstrument(byId.uke, 67);
  assert.equal(out.clef, 'treble');
  assert.equal(out.written, 67);
});

test('forInstrument: voice uses its instrument record clef (treble)', () => {
  const out = forInstrument(byId.voice, 60);
  assert.equal(out.clef, 'treble');
  assert.equal(out.written, 60);
});

test('forInstrument: spelling honours the given key', () => {
  // MIDI 61 (C#/Db) spelled in C major is C#; in F major it is Db.
  const c = forInstrument(byId.kbd, 61, { key: 'C' });
  const f = forInstrument(byId.kbd, 61, { key: 'F' });
  assert.equal(c.spelled.letter + c.spelled.accidental, 'C#');
  assert.equal(f.spelled.letter + f.spelled.accidental, 'Db');
});

test('forInstrument: a fretted item with a known string/fret gets a tab primitive at that position', () => {
  const out = forInstrument(byId.gtr, 45, { item: { string: 5, fret: 0 } });
  assert.equal(out.tab.primitives.length, 1);
  assert.deepEqual(
    { string: out.tab.primitives[0].string, fret: out.tab.primitives[0].fret },
    { string: 5, fret: 0 }
  );
});

test('forInstrument: a fretted item with no string/fret (e.g. "find it by name") falls back to an auto-picked tab position', () => {
  const out = forInstrument(byId.gtr, 45); // no item at all
  assert.equal(out.tab.primitives.length, 1);
  assert.equal(typeof out.tab.primitives[0].string, 'number');
  assert.equal(typeof out.tab.primitives[0].fret, 'number');
});

test('forInstrument: a non-fretted instrument gets no tab', () => {
  const out = forInstrument(byId.kbd, 60);
  assert.equal(out.tab, null);
});
