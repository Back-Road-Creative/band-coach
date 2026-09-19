// src/ui/fingerings/how.js: picking which "how to play it" module applies to
// an instrument record, and building both diagram data and an accessible
// text description from it. Every fact here is COMPUTED by the underlying
// src/instruments/how/*.js modules (already unit tested for the maths) —
// these tests check the wiring and the wording, hand-checked against real
// instrument records.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { howKindFor, computeHow, defaultNoteFor } from '../../src/ui/fingerings/how.js';
import gtr from '../../src/instruments/gtr.js';
import bass from '../../src/instruments/bass.js';
import uke from '../../src/instruments/uke.js';
import violin from '../../src/instruments/violin.js';
import harp from '../../src/instruments/harp.js';
import voice from '../../src/instruments/voice.js';
import kbd from '../../src/instruments/kbd.js';
import wind from '../../src/instruments/wind.js';
import trumpetBb from '../../src/instruments/trumpet-bb.js';
import hornF from '../../src/instruments/horn-f.js';
import trombone from '../../src/instruments/trombone.js';
import recorderDescant from '../../src/instruments/recorder-descant.js';

test('howKindFor picks the right module per instrument', () => {
  assert.equal(howKindFor(gtr), 'fretboard');
  assert.equal(howKindFor(bass), 'fretboard');
  assert.equal(howKindFor(uke), 'fretboard');
  assert.equal(howKindFor(violin), 'fretboard');
  assert.equal(howKindFor(harp), 'harmonica');
  assert.equal(howKindFor(voice), 'voice');
  assert.equal(howKindFor(trumpetBb), 'brass-valves');
  assert.equal(howKindFor(hornF), 'brass-valves');
  assert.equal(howKindFor(trombone), 'brass-slide');
  assert.equal(howKindFor(recorderDescant), 'recorder');
  assert.equal(howKindFor(kbd), null); // keys: obvious, no fingering module
  assert.equal(howKindFor(wind), null); // an abstraction over 7 transpositions, not one real instrument
  assert.equal(howKindFor(null), null);
});

test('fretboard: open low E string on guitar', () => {
  const how = computeHow(gtr, 40); // E2, guitar's lowest open string
  assert.equal(how.kind, 'fretboard');
  assert.equal(how.playable, true);
  assert.deepEqual(how.positions[0], { stringIndex: 0, displayIndex: 0, fret: 0 });
  assert.match(how.description, /string 1 \(E2\), open/);
});

test('fretboard: a note off the neck (below every open string) is unplayable', () => {
  const how = computeHow(gtr, 30);
  assert.equal(how.playable, false);
  assert.match(how.description, /does not fall on this fretboard/);
});

test('brass valves: open partial 2 on Bb trumpet (written) needs no valves', () => {
  // trumpet-bb.js/horn-f.js are written non-transposed C-based, per brass.js's
  // PRESETS comment: fundamental 48, partial 2 = 60 (written C4), open.
  const how = computeHow(trumpetBb, 60);
  assert.equal(how.kind, 'brass-valves');
  assert.equal(how.playable, true);
  assert.equal(how.result.standard.label, 'open');
  assert.match(how.description, /open, no valves/);
});

test('brass slide: trombone 1st position open note', () => {
  // trombone.js fundamental 34 (Bb1); partial 2 = 46 (Bb2), position 1 (drop 0).
  const how = computeHow(trombone, 46);
  assert.equal(how.kind, 'brass-slide');
  assert.equal(how.result.standard.position, 1);
  assert.match(how.description, /slide position 1/);
});

test('harmonica: hole 1 blow is the tonic, no bend', () => {
  const how = computeHow(harp, 60); // C4, harp.js range.low
  assert.equal(how.kind, 'harmonica');
  assert.deepEqual(how.options[0], { hole: 1, action: 'blow', semitonesBent: 0, difficulty: 'open' });
  assert.match(how.description, /hole 1 blow/);
});

test('harmonica: hole 2 draw bent down one semitone (Db4/C#4)', () => {
  // hole 2: blow 64 (E4), draw 67 (G4) -> bend floor 65; 66 is a 1-semitone bend.
  const how = computeHow(harp, 66);
  assert.equal(how.options[0].hole, 2);
  assert.equal(how.options[0].action, 'draw');
  assert.equal(how.options[0].semitonesBent, 1);
  assert.match(how.description, /bent 1 semitone/);
});

test('recorder: C5 is all holes covered', () => {
  const how = computeHow(recorderDescant, 72);
  assert.equal(how.kind, 'recorder');
  assert.equal(how.entry.holes, 'xxxxxxxx');
  assert.match(how.description, /thumb hole covered/);
  assert.match(how.description, /hole 7 covered/);
});

test('recorder: a pitch outside the short table is reported, not thrown', () => {
  const how = computeHow(recorderDescant, 67); // recorderDescant.range.low, but below the table
  assert.equal(how.playable, false);
  assert.match(how.description, /outside this app's recorder fingering chart/);
});

test('voice: in range vs out of range wording', () => {
  const inRange = computeHow(voice, 60);
  assert.equal(inRange.playable, true);
  assert.match(inRange.description, /within the range/);
  const outOfRange = computeHow(voice, 20);
  assert.equal(outOfRange.playable, false);
  assert.match(outOfRange.description, /outside the range/);
});

test('defaultNoteFor picks a note the table actually covers', () => {
  // recorderDescant.range.low (67) is below the fingering table; the first
  // playable note is C5 (72).
  assert.equal(defaultNoteFor(recorderDescant), 72);
  // guitar's own range.low (its lowest open string) is trivially playable.
  assert.equal(defaultNoteFor(gtr), 40);
});
