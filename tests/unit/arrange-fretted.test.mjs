// Unit D1 (band-coach plan §11.7 Wave D): string-and-fret arrangement for
// the 'fretted' instrument family. See src/song/arrange/fretted.js for the
// algorithm; this file is the proof that it fits every starter song on
// every ready fretted instrument without ever dropping a note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeFretted, bestCapo } from '../../src/song/arrange/fretted.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { fitToInstrument } from '../../src/song/lesson.js';
import { starterSongs } from '../../src/song/starter/index.js';

const gtr = INSTRUMENTS.find(r => r.id === 'gtr');

test('hand-checked: open-string ascending melody lands on open frets, one string apiece', () => {
  const notes = [
    { start: 0, dur: 480, midi: 40 },   // open low E
    { start: 480, dur: 480, midi: 45 }, // open A
    { start: 960, dur: 480, midi: 50 }, // open D
    { start: 1440, dur: 480, midi: 55 } // open G
  ];
  const result = arrangeFretted(notes, gtr);
  assert.equal(result.unplayable.length, 0);
  assert.deepEqual(
    result.placed.map(p => ({ string: p.string, fret: p.fret })),
    [{ string: 0, fret: 0 }, { string: 1, fret: 0 }, { string: 2, fret: 0 }, { string: 3, fret: 0 }]
  );
});

test('chord: three simultaneous notes land on distinct strings within a 4-fret span', () => {
  const notes = [
    { start: 0, dur: 480, midi: 43 },
    { start: 0, dur: 480, midi: 47 },
    { start: 0, dur: 480, midi: 50 }
  ];
  const result = arrangeFretted(notes, gtr);
  assert.equal(result.unplayable.length, 0);
  assert.equal(result.placed.length, 3);
  const strings = result.placed.map(p => p.string);
  assert.equal(new Set(strings).size, 3, 'every note is on its own string');
  const frets = result.placed.map(p => p.fret);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 4, 'within a 4-fret hand span');
  // this particular chord has exactly one distinct-string solution
  assert.deepEqual(
    result.placed.map(p => ({ string: p.string, fret: p.fret })),
    [{ string: 0, fret: 3 }, { string: 1, fret: 2 }, { string: 2, fret: 0 }]
  );
});

test('a note with no reachable fret is reported in unplayable, never dropped', () => {
  const notes = [{ start: 0, dur: 480, midi: 4 }]; // far below any open string, capo can't reach it
  const result = arrangeFretted(notes, gtr);
  assert.equal(result.placed.length, 0);
  assert.equal(result.unplayable.length, 1);
  assert.equal(result.unplayable[0].midi, 4);
  assert.equal(result.unplayable[0].reason, 'out-of-range');
});

test('bestCapo picks a capo 0-7, defaulting to the lowest on a tie', () => {
  const notes = [{ start: 0, dur: 480, midi: 40 }];
  const capo = bestCapo(notes, gtr);
  assert.ok(capo >= 0 && capo <= 7);
});

test('family proof: every starter song fits every ready fretted instrument, note for note', () => {
  const fretted = INSTRUMENTS.filter(r => r.family === 'fretted' && r.status === 'ready');
  assert.ok(fretted.length > 0, 'at least one ready fretted instrument to test against');
  const maxFret = 12;

  for (const song of starterSongs) {
    for (const instrument of fretted) {
      const fit = fitToInstrument(song, 'melody', instrument);
      const notes = fit.notes;
      if (notes.length === 0) continue;
      const capo = bestCapo(notes, instrument, { maxFret });
      const result = arrangeFretted(notes, instrument, { capo, maxFret });

      assert.equal(
        result.placed.length + result.unplayable.length,
        notes.length,
        `${song.id} on ${instrument.id}: every note must be placed or explained`
      );

      for (const p of result.placed) {
        assert.ok(p.fret >= 0 && p.fret <= maxFret, `${song.id} on ${instrument.id}: fret ${p.fret} out of range`);
        const openPitch = instrument.tuning[p.string] + capo;
        assert.equal(
          openPitch + p.fret,
          p.midi,
          `${song.id} on ${instrument.id}: string ${p.string} fret ${p.fret} capo ${capo} does not sound written pitch ${p.midi}`
        );
      }
    }
  }
});
