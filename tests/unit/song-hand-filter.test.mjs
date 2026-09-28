// Unit H1: explicit per-note hand data ('rh'/'lh') on a Song note, and a
// pure filter (src/song/hand-filter.js) that picks one hand's notes out of a
// keyboard arrangement/practice step. Proves the explicit tag -- not the
// middle-C pitch split -- decides whether a song offers a hand choice at
// all, so a one-part melody like Frère Jacques or Amazing Grace stays
// one-handed even though splitHands sends some of its notes below middle C
// to the left hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { arrangeFor } from '../../src/song/arrange/index.js';
import { arrangeKeys } from '../../src/song/arrange/keys.js';
import { normalizeSong, validateSong } from '../../src/song/model.js';
import { handsAvailable, stepForHands } from '../../src/song/hand-filter.js';

const kbd = INSTRUMENTS.find(r => r.id === 'kbd');
const gtr = INSTRUMENTS.find(r => r.id === 'gtr');

function arr(song, partId) {
  const fit = buildLessonPlan(song, partId, kbd).fit;
  return arrangeFor(fit.notes, kbd, {});
}

function baseSong(parts) {
  return {
    schema: 'song/1', id: 'fixture', title: 'Fixture', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts, chords: []
  };
}

test('normalizeSong keeps note.hand, and rejects an unrecognized value', () => {
  const song = baseSong([
    { id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 480, midi: 60, hand: 'rh' },
      { start: 480, dur: 480, midi: 48, hand: 'lh' }
    ] }
  ]);
  const normalized = normalizeSong(song);
  assert.equal(normalized.parts[0].notes[0].hand, 'rh');
  assert.equal(normalized.parts[0].notes[1].hand, 'lh');

  const bad = baseSong([
    { id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60, hand: 'x' }] }
  ]);
  assert.ok(validateSong(bad).errors.some(e => e.includes('.hand')), 'validateSong should flag hand:"x"');
  assert.throws(() => normalizeSong(bad), /hand/);
});

test('arrangeKeys: an explicit note.hand wins over the middle-C pitch split', () => {
  const notes = [
    { start: 0, dur: 480, midi: 55, hand: 'rh' }, // G3, would split lh by pitch
    { start: 480, dur: 480, midi: 64, hand: 'lh' } // E4, would split rh by pitch
  ];
  const result = arrangeKeys(notes, kbd);
  assert.deepEqual(result.rh.map(n => n.midi), [55]);
  assert.deepEqual(result.lh.map(n => n.midi), [64]);

  const untagged = [{ start: 0, dur: 480, midi: 55 }];
  const untaggedResult = arrangeKeys(untagged, kbd);
  assert.deepEqual(untaggedResult.lh.map(n => n.midi), [55]);
  assert.equal(untaggedResult.rh.length, 0);
});

test('handsAvailable: an untagged one-part melody is right-hand-only even though splitHands puts some of it left', () => {
  for (const id of ['frere-jacques', 'amazing-grace']) {
    const song = starterSongs.find(s => s.id === id);
    const arrangement = arr(song, 'melody');
    assert.deepEqual(handsAvailable(song, 'melody', arrangement), ['rh'], `${id}: should be rh-only`);
    const hands = [...arrangement.placements.values()].map(p => p.hand);
    assert.ok(hands.includes('lh'), `${id}: the pitch split must really have put some notes in lh (proves the answer isn't derived from placements)`);
  }
});

test('handsAvailable: both hands only when the part has notes explicitly tagged for both, and [] off the keys family', () => {
  const fixture = normalizeSong(baseSong([
    {
      id: 'piano', name: 'Piano', notes: [
        { start: 0, dur: 240, midi: 60, hand: 'rh' },
        { start: 0, dur: 240, midi: 48, hand: 'lh' },
        { start: 240, dur: 240, midi: 67, hand: 'rh' },
        { start: 240, dur: 240, midi: 55, hand: 'lh' }
      ]
    },
    {
      id: 'melody', name: 'Melody', notes: [
        { start: 0, dur: 240, midi: 60 },
        { start: 240, dur: 240, midi: 62 }
      ]
    }
  ]));

  const pianoArr = arr(fixture, 'piano');
  assert.deepEqual(handsAvailable(fixture, 'piano', pianoArr).sort(), ['lh', 'rh']);

  const melodyArr = arr(fixture, 'melody');
  assert.deepEqual(handsAvailable(fixture, 'melody', melodyArr), ['rh']);

  assert.equal(gtr.family, 'fretted');
  const gtrArr = arrangeFor(fixture.parts[0].notes, gtr, {});
  assert.deepEqual(handsAvailable(fixture, 'piano', gtrArr), []);
});

test('stepForHands: picks the requested hand\'s notes, keeping object identity with step.notes', () => {
  const fixture = normalizeSong(baseSong([
    {
      id: 'piano', name: 'Piano', notes: [
        { start: 0, dur: 240, midi: 60, hand: 'rh' },
        { start: 0, dur: 240, midi: 48, hand: 'lh' },
        { start: 240, dur: 240, midi: 67, hand: 'rh' },
        { start: 240, dur: 240, midi: 55, hand: 'lh' }
      ]
    }
  ]));
  const plan = buildLessonPlan(fixture, 'piano', kbd);
  const arrangement = arr(fixture, 'piano');
  const step = plan.steps.find(s => s.kind === 'phrase-slow');
  assert.ok(step, 'fixture should produce a phrase-slow step');

  const left = stepForHands(step, arrangement, 'left');
  assert.deepEqual(left.judged, step.notes.filter(n => n.hand === 'lh'));
  assert.deepEqual(left.played, step.notes.filter(n => n.hand === 'rh'));
  assert.ok(left.played.length > 0, 'played must actually hold the other hand\'s notes, not an empty list');
  assert.equal(left.assessed, true);
  for (const n of [...left.judged, ...left.played]) {
    assert.ok(step.notes.includes(n), 'must be the same object reference as an element of step.notes');
  }

  const right = stepForHands(step, arrangement, 'right');
  assert.deepEqual(right.judged, step.notes.filter(n => n.hand === 'rh'));
  assert.deepEqual(right.played, step.notes.filter(n => n.hand === 'lh'));
  assert.ok(right.played.length > 0, 'played must actually hold the other hand\'s notes, not an empty list');

  const both = stepForHands(step, arrangement, 'both');
  assert.deepEqual(both.judged, step.notes);
  assert.deepEqual(both.played, []);
});

test('stepForHands: no notes for the requested hand gives assessed:false, and an untagged part judges rh with "right"', () => {
  const rhOnlyStep = { notes: [{ start: 0, dur: 240, midi: 60, hand: 'rh' }] };
  const arrangement = { family: 'keys', placements: new Map() };
  const left = stepForHands(rhOnlyStep, arrangement, 'left');
  assert.deepEqual(left.judged, []);
  assert.equal(left.assessed, false);

  const song = starterSongs.find(s => s.id === 'frere-jacques');
  const arrangement2 = arr(song, 'melody');
  const plan = buildLessonPlan(song, 'melody', kbd);
  const step = plan.steps.find(s => s.kind === 'phrase-slow');
  const right = stepForHands(step, arrangement2, 'right');
  assert.deepEqual(right.judged, step.notes);
  assert.equal(right.assessed, true);
});
