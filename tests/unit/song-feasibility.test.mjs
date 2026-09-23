import { test } from 'node:test';
import assert from 'node:assert/strict';

import { feasibility } from '../../src/song/feasibility.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import gtr from '../../src/instruments/gtr.js';
import harp from '../../src/instruments/harp.js';

const readyInstruments = INSTRUMENTS.filter((i) => i.status === 'ready');

function note(start, dur, midi) {
  return { start, dur, midi };
}

test('every ready instrument gets a defined feasibility level for every starter song part', () => {
  starterSongs.forEach((song) => {
    song.parts.forEach((part) => {
      readyInstruments.forEach((instrument) => {
        const f = feasibility(song, part.id, instrument);
        assert.ok(
          ['as-written', 'transposed', 'partial', 'unplayable', 'empty'].includes(f.level),
          `${song.id}/${part.id} on ${instrument.id}: unexpected level "${f.level}"`
        );
        assert.equal(typeof f.label, 'string');
        assert.ok(f.label.length > 0);
        assert.equal(typeof f.detail, 'string');
      });
    });
  });
});

test('a song already sitting inside the instrument range, unchanged, reports as-written', () => {
  const song = {
    schema: 'song/1', id: 'fits', title: 'Fits', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [note(0, 480, 45), note(480, 480, 47), note(960, 480, 50)] }],
    chords: [],
  };
  const f = feasibility(song, 'melody', gtr); // gtr range 40-76, well inside
  assert.equal(f.level, 'as-written');
  assert.equal(f.label, 'Fits as written');
});

test('a song written far outside the instrument range gets shifted by whole octaves and reports transposed', () => {
  // gtr range is 40-76; write the whole tune above the top of that range so
  // fitToInstrument has to shift it down an octave to land back in range,
  // never dropping a note.
  const song = {
    schema: 'song/1', id: 'octave', title: 'Octave', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [note(0, 480, 81), note(480, 480, 83), note(960, 480, 86)] }],
    chords: [],
  };
  const f = feasibility(song, 'melody', gtr);
  assert.equal(f.level, 'transposed');
  assert.equal(f.label, 'Transposed to C');
});

test('a harmonica-unfriendly melody with genuinely out-of-reach notes reports partial or unplayable, never as-written', () => {
  // Harmonica (free-reed) can only pick a fixed set of holes; a chromatic
  // run guarantees some notes miss every candidate shift.
  const song = {
    schema: 'song/1', id: 'chromatic', title: 'Chromatic', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{
      id: 'melody', name: 'Melody',
      notes: Array.from({ length: 12 }, (_, i) => note(i * 480, 480, 60 + i)),
    }],
    chords: [],
  };
  const f = feasibility(song, 'melody', harp);
  assert.ok(['partial', 'unplayable'].includes(f.level));
  assert.match(f.label, /skipped/);
});

test('a part with no notes reports empty, not a false pass', () => {
  const song = {
    schema: 'song/1', id: 'silent', title: 'Silent', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [] }],
    chords: [],
  };
  const f = feasibility(song, 'melody', gtr);
  assert.equal(f.level, 'empty');
});
