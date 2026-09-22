// src/ui/fingerings/how.js: picking which "how to play it" module applies to
// an instrument record, and building both diagram data and an accessible
// text description from it. Every fact here is COMPUTED by the underlying
// src/instruments/how/*.js modules (already unit tested for the maths) —
// these tests check the wiring and the wording, hand-checked against real
// instrument records.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { howKindFor, computeHow, defaultNoteFor, alternateTuningsFor } from '../../src/ui/fingerings/how.js';
import gtr from '../../src/instruments/gtr.js';
import bass from '../../src/instruments/bass.js';
import uke from '../../src/instruments/uke.js';
import violin from '../../src/instruments/violin.js';
import viola from '../../src/instruments/viola.js';
import cello from '../../src/instruments/cello.js';
import harp from '../../src/instruments/harp.js';
import voice from '../../src/instruments/voice.js';
import kbd from '../../src/instruments/kbd.js';
import wind from '../../src/instruments/wind.js';
import trumpetBb from '../../src/instruments/trumpet-bb.js';
import hornF from '../../src/instruments/horn-f.js';
import trombone from '../../src/instruments/trombone.js';
import recorderDescant from '../../src/instruments/recorder-descant.js';
import tinWhistle from '../../src/instruments/tin-whistle.js';
import flute from '../../src/instruments/flute.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import oboe from '../../src/instruments/oboe.js';
import saxAlto from '../../src/instruments/sax-alto-eb.js';
import saxTenor from '../../src/instruments/sax-tenor-bb.js';

test('howKindFor picks the right module per instrument', () => {
  assert.equal(howKindFor(gtr), 'fretboard');
  assert.equal(howKindFor(bass), 'fretboard');
  assert.equal(howKindFor(uke), 'fretboard');
  // Bowed instruments are fretless (schema.js's `fretted: false`): they get
  // a plain fingerboard diagram, never fret wires (defect fix, was
  // 'fretboard' for every stringed instrument regardless of frets).
  assert.equal(howKindFor(violin), 'fingerboard');
  assert.equal(howKindFor(viola), 'fingerboard');
  assert.equal(howKindFor(cello), 'fingerboard');
  assert.equal(howKindFor(harp), 'harmonica');
  assert.equal(howKindFor(voice), 'voice');
  assert.equal(howKindFor(trumpetBb), 'brass-valves');
  assert.equal(howKindFor(hornF), 'brass-valves');
  assert.equal(howKindFor(trombone), 'brass-slide');
  assert.equal(howKindFor(recorderDescant), 'recorder');
  assert.equal(howKindFor(tinWhistle), 'whistle');
  assert.equal(howKindFor(flute), 'keyed-woodwind');
  assert.equal(howKindFor(clarinetBb), 'keyed-woodwind');
  assert.equal(howKindFor(oboe), 'keyed-woodwind');
  assert.equal(howKindFor(saxAlto), 'keyed-woodwind');
  assert.equal(howKindFor(saxTenor), 'keyed-woodwind');
  assert.equal(howKindFor(kbd), null); // keys: obvious, no fingering module
  assert.equal(howKindFor(wind), null); // an abstraction over 7 transpositions, not one real instrument
  assert.equal(howKindFor(null), null);
});

test('keyed-woodwind: flute writes the low C fingering, described in words', () => {
  const how = computeHow(flute, 60); // C4, flute.range.low
  assert.equal(how.kind, 'keyed-woodwind');
  assert.equal(how.playable, true);
  assert.match(how.description, /footjoint: low C/);
});

test('keyed-woodwind: oboe D5 is flagged half-hole and the description names it', () => {
  const how = computeHow(oboe, 74); // D5, oboe.range.high
  assert.equal(how.kind, 'keyed-woodwind');
  assert.equal(how.playable, true);
  assert.match(how.description, /half-hole/);
});

test('keyed-woodwind: sax Bb3 (the horn\'s lowest written note) is playable', () => {
  const how = computeHow(saxAlto, 58); // Bb3, saxAlto.range.low after the range fix
  assert.equal(how.kind, 'keyed-woodwind');
  assert.equal(how.playable, true);
  assert.match(how.description, /low Bb key/);
});

test('keyed-woodwind: a pitch outside the chart is reported plainly, not thrown', () => {
  const how = computeHow(clarinetBb, 40); // far below clarinet.range.low
  assert.equal(how.kind, 'keyed-woodwind');
  assert.equal(how.playable, false);
  assert.match(how.description, /no fingering shown/);
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

test('fingerboard: open low G string on violin has no fret wires', () => {
  const how = computeHow(violin, 55); // G3, violin's lowest open string
  assert.equal(how.kind, 'fingerboard');
  assert.equal(how.playable, true);
  assert.deepEqual(how.positions[0], { stringIndex: 0, displayIndex: 0, fret: 0 });
  assert.match(how.description, /open string/);
  assert.doesNotMatch(how.description, /\bfret \d/);
});

test('fingerboard: a stopped note describes semitones up, not a fret number', () => {
  const how = computeHow(violin, 57); // A3, 2 semitones up the G string
  assert.equal(how.kind, 'fingerboard');
  assert.match(how.description, /2 semitones up/);
  assert.doesNotMatch(how.description, /\bfret \d/);
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

test('whistle: D6 (second-octave tonic) is vented, and the description names it', () => {
  const how = computeHow(tinWhistle, 86);
  assert.equal(how.kind, 'whistle');
  assert.equal(how.entry.holes, 'oxxxxx');
  assert.match(how.description, /hole 1 open/);
});

test('whistle: a pitch outside the table is reported, not thrown', () => {
  const how = computeHow(tinWhistle, 75); // D#5, not a diatonic D-major note
  assert.equal(how.playable, false);
  assert.match(how.description, /outside this app's whistle fingering chart/);
});

test('voice: in range vs out of range wording', () => {
  const inRange = computeHow(voice, 60);
  assert.equal(inRange.playable, true);
  assert.match(inRange.description, /within the range/);
  const outOfRange = computeHow(voice, 20);
  assert.equal(outOfRange.playable, false);
  assert.match(outOfRange.description, /outside the range/);
});

test('alternateTuningsFor: guitar has named alternates, bass and violin do not', () => {
  const gtrAlts = alternateTuningsFor(gtr);
  assert.ok(Array.isArray(gtrAlts));
  assert.ok(gtrAlts.includes('standard'));
  assert.ok(gtrAlts.includes('drop-d'));
  assert.ok(gtrAlts.includes('dadgad'));
  assert.equal(alternateTuningsFor(bass), null); // 4-string, but not a named alternate set
  assert.equal(alternateTuningsFor(violin), null); // fingerboard, not fretboard
});

test('fretboard: a capo shifts fret numbers and is named in the description', () => {
  const how = computeHow(gtr, 42, { capo: 2 }); // F#3, capo 2 -> open low string
  assert.equal(how.capo, 2);
  assert.deepEqual(how.positions[0], { stringIndex: 0, displayIndex: 0, fret: 0 });
  assert.match(how.description, /capo/);
});

test('fretboard: a note below the capo cannot be shown, and says so plainly', () => {
  const how = computeHow(gtr, 40, { capo: 2 }); // open low E, now behind the capo
  assert.equal(how.playable, false);
  assert.match(how.description, /below the capo/);
});

test('fretboard: a named alternate tuning changes which strings sound which notes', () => {
  const standard = computeHow(gtr, 38, {}); // D2 is not on standard tuning's open strings
  assert.equal(standard.playable, false);
  const dropD = computeHow(gtr, 38, { tuning: 'drop-d' });
  assert.equal(dropD.playable, true);
  assert.deepEqual(dropD.positions[0], { stringIndex: 0, displayIndex: 0, fret: 0 });
});

test('fretboard: leftHanded mirrors displayIndex without changing the fret or pitch', () => {
  const normal = computeHow(gtr, 40, {});
  const mirrored = computeHow(gtr, 40, { leftHanded: true });
  assert.equal(normal.positions[0].fret, mirrored.positions[0].fret);
  assert.equal(normal.positions[0].stringIndex, mirrored.positions[0].stringIndex);
  assert.equal(mirrored.positions[0].displayIndex, gtr.tuning.length - 1 - normal.positions[0].stringIndex);
});

test('fingerboard: capo and tuning opts are ignored (fretless instruments have neither)', () => {
  const how = computeHow(violin, 55, { capo: 2, tuning: 'drop-d' });
  assert.equal(how.capo, 0);
  assert.deepEqual(how.positions[0], { stringIndex: 0, displayIndex: 0, fret: 0 });
});

test('defaultNoteFor picks a note the table actually covers', () => {
  // recorderDescant.range.low (67) is below the fingering table; the first
  // playable note is C5 (72).
  assert.equal(defaultNoteFor(recorderDescant), 72);
  // guitar's own range.low (its lowest open string) is trivially playable.
  assert.equal(defaultNoteFor(gtr), 40);
});
