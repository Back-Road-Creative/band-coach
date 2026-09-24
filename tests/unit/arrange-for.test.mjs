import { test } from 'node:test';
import assert from 'node:assert/strict';

import { arrangeFor, arrangementKey, songForArrangement } from '../../src/song/arrange/index.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { tuningFor } from '../../src/instruments/how/fretboard.js';
import { instrumentSetup } from '../../src/ui/fingerings/setup.js';

const gtr = INSTRUMENTS.find(r => r.id === 'gtr');
const violin = INSTRUMENTS.find(r => r.id === 'violin');
const kbd = INSTRUMENTS.find(r => r.id === 'kbd');
const harp = INSTRUMENTS.find(r => r.id === 'harp');
const clarinetBb = INSTRUMENTS.find(r => r.id === 'clarinet-bb');
const drumKit = INSTRUMENTS.find(r => r.id === 'drum-kit');

function notes(midis) {
  return midis.map((midi, i) => ({ start: i * 480, dur: 480, midi }));
}

test('guitar with capo 2 places every note relative to the capo', () => {
  const n = notes([42, 47, 50]); // reachable at various frets with capo 2
  const arr = arrangeFor(n, gtr, { capo: 2, tuningMidi: gtr.tuning });
  assert.equal(arr.family, 'fretted');
  assert.equal(arr.capo, 2);
  assert.equal(arr.placements.size, n.length);
  for (const [index, placement] of arr.placements) {
    assert.equal(gtr.tuning[placement.string] + 2 + placement.fret, n[index].midi);
  }
});

test('drop-D moves a low D to the open sixth string', () => {
  const lowD = 38; // one whole tone below standard open low E (40)
  const n = notes([lowD]);
  const dropD = tuningFor('drop-d');
  const arr = arrangeFor(n, gtr, { capo: 0, tuning: 'drop-d', tuningMidi: dropD });
  assert.equal(arr.tuningName, 'drop-d');
  assert.deepEqual(arr.placements.get(0), { string: 0, fret: 0 });
});

test('violin gets string and position', () => {
  // open G, then D -- the DP prefers finger 4 (a 5th up) on the SAME
  // string over crossing to the open D string, per bowed.js's own
  // crossing-vs-shift cost order (see its module header).
  const n = notes([55, 62]);
  const arr = arrangeFor(n, violin, {});
  assert.equal(arr.family, 'bowed');
  assert.deepEqual(arr.placements.get(0), { string: 0, position: 1, finger: 0 });
  assert.deepEqual(arr.placements.get(1), { string: 0, position: 1, finger: 4 });
});

test('keyboard splits hands', () => {
  const n = notes([48, 72]); // well below and above the default split (60)
  const arr = arrangeFor(n, kbd, {});
  assert.equal(arr.family, 'keys');
  assert.equal(arr.placements.get(0).hand, 'lh');
  assert.equal(arr.placements.get(1).hand, 'rh');
  assert.ok(Number.isInteger(arr.placements.get(0).finger));
  assert.ok(Number.isInteger(arr.placements.get(1).finger));
});

test('a harmonica in the wrong key gets advice, not a throw', () => {
  // F#5 (66) is not in a C harmonica's (key 0) open major scale in any
  // octave, but IS the open major scale of a G harmonica (key 7).
  const n = notes([66]);
  assert.doesNotThrow(() => arrangeFor(n, harp, { harpKey: 0 }));
  const arr = arrangeFor(n, harp, { harpKey: 0 });
  assert.equal(arr.family, 'free-reed');
  assert.equal(arr.placements.size, 0);
  assert.equal(arr.harpAdvice, 'Best on a G harmonica — yours is set to C.');
});

test('a harmonica in the right key is arranged, not just advised', () => {
  const n = notes([60, 64, 67]); // open C major triad, C harmonica
  const arr = arrangeFor(n, harp, { harpKey: 0 });
  assert.equal(arr.harpAdvice, null);
  assert.equal(arr.placements.size, n.length);
  for (const [, placement] of arr.placements) {
    assert.ok(Number.isInteger(placement.hole));
    assert.ok(placement.action === 'blow' || placement.action === 'draw' || placement.action === 'bend');
  }
});

test('a voice range below the song moves it down and names the new key', () => {
  const n = notes([72, 76, 79]); // C major triad up high, out of a low voice's comfort
  const arr = arrangeFor(n, INSTRUMENTS.find(r => r.id === 'voice'), { voiceRange: { low: 43, high: 57 } }, { songKey: { tonic: 0, mode: 'major' } });
  assert.equal(arr.family, 'voice');
  assert.ok(arr.shiftSemitones < 0, 'a high triad against a low voice range should move down');
  assert.ok(arr.newKeyName, 'a songKey was supplied, so the moved key should be named');
  assert.match(arr.summary, /Moved down/);
});

test('no voice range means no key change', () => {
  const n = notes([72, 76, 79]);
  const arr = arrangeFor(n, INSTRUMENTS.find(r => r.id === 'voice'), {}, { songKey: { tonic: 0, mode: 'major' } });
  assert.equal(arr.shiftSemitones, 0);
  assert.equal(arr.newKeyName, null);
  assert.equal(arr.summary, null);
});

test('clarinet has no placements but a written-pitch summary', () => {
  const n = notes([60, 62]);
  const arr = arrangeFor(n, clarinetBb, {});
  assert.equal(arr.family, 'wind');
  assert.equal(arr.placements.size, 0);
  assert.equal(arr.summary, 'Written for Clarinet (B flat): a tone higher than it sounds.');
});

test('the drum kit has no placements', () => {
  const n = notes([36, 38]);
  const arr = arrangeFor(n, drumKit, {});
  assert.equal(arr.family, 'percussion');
  assert.equal(arr.placements.size, 0);
  assert.equal(arr.unplayable.length, 0);
});

test('arrangementKey changes when capo changes', () => {
  const n = notes([42, 47, 50]);
  const capo0 = arrangeFor(n, gtr, { capo: 0, tuningMidi: gtr.tuning });
  const capo2 = arrangeFor(n, gtr, { capo: 2, tuningMidi: gtr.tuning });
  assert.notEqual(arrangementKey(capo0), arrangementKey(capo2));
});

// ---------------------------------------------------------------------------
// P4-5's instrumentSetup shape feeds straight into arrangeFor
// ---------------------------------------------------------------------------

test('arrangeFor accepts instrumentSetup()\'s shape directly', () => {
  const n = notes([40, 45]);
  const setup = instrumentSetup(gtr, { fingeringsStore: null, prefs: null });
  assert.doesNotThrow(() => arrangeFor(n, gtr, setup));
});

// ---------------------------------------------------------------------------
// songForArrangement
// ---------------------------------------------------------------------------

function song(midis) {
  return {
    schema: 'song/1', id: 'arrange-for-song', title: 'Arrange check', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: notes(midis) }],
    chords: []
  };
}

test('songForArrangement shifts the song when the arrangement is a voice key move', () => {
  const s = song([72, 76, 79]);
  const arr = arrangeFor(s.parts[0].notes, INSTRUMENTS.find(r => r.id === 'voice'), { voiceRange: { low: 43, high: 57 } }, { songKey: s.key });
  const shifted = songForArrangement(s, 'melody', arr);
  assert.equal(shifted.parts[0].notes[0].midi, 72 + arr.shiftSemitones);
  assert.equal(s.parts[0].notes[0].midi, 72, 'the input song is not mutated');
});

test('songForArrangement leaves a non-voice arrangement unchanged', () => {
  const s = song([42, 47, 50]);
  const arr = arrangeFor(s.parts[0].notes, gtr, { capo: 2, tuningMidi: gtr.tuning });
  const same = songForArrangement(s, 'melody', arr);
  assert.equal(same, s);
});
