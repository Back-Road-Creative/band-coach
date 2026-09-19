import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importAbc } from '../../src/song/import-abc.js';

const TPQ = 480;

test('imports a one-octave C major scale, one eighth note each, correct ticks/midi', () => {
  // L:1/8 -> each unit note is an eighth note = TPQ/2 ticks.
  const abc = `X:1\nT:Scale\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n`;
  const { song, warnings } = importAbc(abc);
  assert.equal(song.schema, 'song/1');
  assert.equal(song.ticksPerQuarter, TPQ);
  assert.equal(song.title, 'Scale');
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' });
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  const notes = song.parts[0].notes;
  const expectedMidi = [60, 62, 64, 65, 67, 69, 71, 72]; // C4..B4, c=C5
  notes.forEach((n, i) => {
    assert.equal(n.start, i * (TPQ / 2), `note ${i} start`);
    assert.equal(n.dur, TPQ / 2, `note ${i} dur`);
    assert.equal(n.midi, expectedMidi[i], `note ${i} midi`);
  });
  assert.ok(warnings.some((w) => /no Q: tempo/.test(w)));
});
test('a tune with a pickup and a simple repeat expands the repeated bar', () => {
  // Pickup: single eighth note before the first bar. Then a one-bar repeat.
  const abc = `X:1\nT:Pickup Tune\nM:4/4\nL:1/8\nK:C\nG |: CD :|\n`;
  const { song } = importAbc(abc);
  const notes = song.parts[0].notes;
  const half = TPQ / 2;
  // pickup G, then C D C D (bar repeated once).
  assert.equal(notes.length, 5);
  assert.equal(notes[0].midi, 67); // pickup G4
  assert.equal(notes[0].start, 0);
  assert.equal(notes[1].midi, 60); // C4
  assert.equal(notes[1].start, half);
  assert.equal(notes[2].midi, 62); // D4
  assert.equal(notes[2].start, half * 2);
  assert.equal(notes[3].midi, 60); // C4 (repeat)
  assert.equal(notes[3].start, half * 3);
  assert.equal(notes[4].midi, 62); // D4 (repeat)
  assert.equal(notes[4].start, half * 4);
});
test('key signature accidentals and explicit accidentals lasting to the bar line', () => {
  // K:D has F# and C# in its signature. An explicit natural on the first F
  // should last for the rest of that bar; the next bar reverts to F#.
  const abc = `X:1\nT:T\nM:4/4\nL:1/8\nK:D\n=FF|F2\n`;
  const { song } = importAbc(abc);
  const notes = song.parts[0].notes;
  assert.deepEqual(song.key, { tonic: 2, mode: 'major' });
  assert.equal(notes[0].midi, 65); // =F natural, F4 = 65
  assert.equal(notes[1].midi, 65); // still natural within the same bar
  assert.equal(notes[2].midi, 66); // next bar: key signature F# = 66
});
test('a clarinet-style tuplet: (3 scales the next three notes to 2/3 length', () => {
  const abc = `X:1\nT:T\nM:4/4\nL:1/8\nK:C\n(3CDE F\n`;
  const { song } = importAbc(abc);
  const notes = song.parts[0].notes;
  const eighth = TPQ / 2;
  const tripletDur = Math.round(eighth * (2 / 3));
  assert.equal(notes[0].dur, tripletDur);
  assert.equal(notes[1].dur, tripletDur);
  assert.equal(notes[2].dur, tripletDur);
  assert.equal(notes[3].dur, eighth); // F not part of the tuplet
  assert.equal(notes[3].start, notes[2].start + tripletDur);
});
test('note lengths: multiplier, simple and compound fractions, broken rhythm, ties, rests', () => {
  const abc = `X:1\nT:T\nM:4/4\nL:1/8\nK:C\nC2 D/2 E3/2 z F-|F\n`;
  const { song } = importAbc(abc);
  const notes = song.parts[0].notes;
  const eighth = TPQ / 2;
  assert.equal(notes[0].dur, eighth * 2); // C2
  assert.equal(notes[1].dur, eighth / 2); // D/2
  assert.equal(notes[2].dur, eighth * 1.5); // E3/2
  // z (rest, one eighth) advances time without a note.
  assert.equal(notes[3].midi, 65); // F
  assert.equal(notes[4].tieFromPrev, true); // F tied across the bar line
});
test('modal key (A dorian) maps to its relative major/minor', () => {
  // A dorian shares its key signature (1 sharp, F#) with G major / E minor.
  // Song only knows major/minor, so a modal key reports the relative
  // major-or-minor key object that carries the same accidentals — here the
  // relative minor, E minor (tonic pitch class 4).
  const abc = `X:1\nT:T\nM:4/4\nL:1/8\nK:Ador\nA\n`;
  const { song } = importAbc(abc);
  assert.deepEqual(song.key, { tonic: 4, mode: 'minor' });
});
test('chord symbols become song.chords; grace notes and decorations are skipped with a warning', () => {
  const abc = `X:1\nT:T\nM:4/4\nL:1/8\nK:C\n"C"C {ag}D !f!E\n`;
  const { song, warnings } = importAbc(abc);
  assert.equal(song.chords.length, 1);
  assert.equal(song.chords[0].symbol, 'C');
  assert.equal(song.chords[0].start, 0);
  assert.equal(song.parts[0].notes.length, 3); // C, D, E (grace note skipped, not counted)
  assert.ok(warnings.some((w) => /grace note/.test(w)));
  assert.ok(warnings.some((w) => /decoration/.test(w)));
});
test('C and C| meter shorthands', () => {
  const { song: songC } = importAbc('X:1\nT:T\nM:C\nK:C\nC\n');
  assert.deepEqual(songC.metre, { num: 4, den: 4 });
  const { song: songCut } = importAbc('X:1\nT:T\nM:C|\nK:C\nC\n');
  assert.deepEqual(songCut.metre, { num: 2, den: 2 });
});
