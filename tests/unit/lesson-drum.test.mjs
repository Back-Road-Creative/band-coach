// Lesson generation for channel-10/percussion parts (U4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitToInstrument, buildLessonPlan } from '../../src/song/lesson.js';
import drumKit from '../../src/instruments/drum-kit.js';
import malletPercussion from '../../src/instruments/mallet-percussion.js';
import gtr from '../../src/instruments/gtr.js';

function note(start, dur, midi, piece) {
  return { start, dur, midi, piece };
}

function drumSong(notes, overrides = {}) {
  return {
    schema: 'song/1', id: 'drum-song', title: 'Drum Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes, ...overrides }],
    chords: []
  };
}

function pitchedSong(notes) {
  return {
    schema: 'song/1', id: 'pitched-song', title: 'Pitched Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes }],
    chords: []
  };
}

// ---- fitToInstrument ----

test('fitToInstrument scores a percussion part on the drum kit by its mapped share, never throwing', () => {
  const song = drumSong([
    note(0, 480, 38, 'snare'), note(480, 480, 35, 'kick'), note(960, 480, 39, null),
  ]);
  const fit = fitToInstrument(song, 'kit', drumKit);
  assert.equal(fit.fitScore, 2 / 3);
  assert.equal(fit.reason, null);
  assert.deepEqual(fit.unplayable, []);
  assert.equal(fit.changed, false);
  assert.equal(fit.notes.length, 3);
  fit.notes.forEach((n, i) => assert.equal(n.piece, song.parts[0].notes[i].piece));
});

test('fitToInstrument gives a fully-mapped percussion part fitScore 1', () => {
  const song = drumSong([note(0, 480, 38, 'snare'), note(480, 480, 35, 'kick')]);
  const fit = fitToInstrument(song, 'kit', drumKit);
  assert.equal(fit.fitScore, 1);
});

test('fitToInstrument gives fit 0 when an instrument other than the drum kit gets a percussion part', () => {
  const song = drumSong([note(0, 480, 38, 'snare')]);
  for (const instrument of [gtr, malletPercussion]) {
    const fit = fitToInstrument(song, 'kit', instrument);
    assert.equal(fit.fitScore, 0);
    assert.equal(fit.reason, 'percussion part needs the drum kit');
    assert.equal(fit.unplayable.length, 1);
    assert.equal(fit.unplayable[0].reason, 'percussion part needs the drum kit');
  }
});

test('fitToInstrument gives fit 0 when the drum kit gets a pitched (non-percussion) part', () => {
  const song = pitchedSong([{ start: 0, dur: 480, midi: 60 }]);
  const fit = fitToInstrument(song, 'melody', drumKit);
  assert.equal(fit.fitScore, 0);
  assert.equal(fit.reason, 'the drum kit only plays percussion parts');
  assert.equal(fit.unplayable.length, 1);
});

// ---- buildLessonPlan ----

test('buildLessonPlan for the drum kit carries piece on every expected note', () => {
  const song = drumSong([
    note(0, 480, 38, 'snare'), note(480, 480, 35, 'kick'), note(1920, 480, 42, 'hihat-closed'),
  ]);
  const plan = buildLessonPlan(song, 'kit', drumKit, { level: 1 });
  assert.equal(plan.fit.fitScore, 1);
  assert.ok(plan.steps.length > 0);
  const listenStep = plan.steps.find(s => s.kind === 'listen');
  assert.ok(listenStep);
  listenStep.notes.forEach(n => assert.ok('piece' in n));
});

test('buildLessonPlan for a percussion part on the wrong instrument produces no playable steps but does not throw', () => {
  const song = drumSong([note(0, 480, 38, 'snare')]);
  const plan = buildLessonPlan(song, 'kit', gtr, { level: 1 });
  assert.equal(plan.fit.fitScore, 0);
  assert.deepEqual(plan.steps, []);
});
