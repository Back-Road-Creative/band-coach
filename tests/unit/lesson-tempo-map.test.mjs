import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLessonPlan } from '../../src/song/lesson.js';
import { starterSongs } from '../../src/song/starter/index.js';
import gtr from '../../src/instruments/gtr.js';

// P4-2: a lesson step's bpm now reads the song clock (src/song/clock.js) at
// the step's originTick instead of a single flat song.bpm, so a step that
// starts after a tempoMap change plays and is judged at the tempo in force
// there. A song without a tempoMap (every starter song, still) must see the
// exact same numbers as before this unit -- clock.bpmAt(tick) is just
// song.bpm everywhere when there is no tempoMap entry past tick 0.

function hotCrossBuns() {
  return starterSongs.find((s) => s.id === 'hot-cross-buns');
}

test("a flat song's steps keep their bpm", () => {
  const song = hotCrossBuns();
  const plan = buildLessonPlan(song, 'melody', gtr);
  const listen = plan.steps.filter((s) => s.kind === 'listen');
  const rhythm = plan.steps.filter((s) => s.kind === 'rhythm');
  const chain = plan.steps.filter((s) => s.kind === 'chain');
  const whole = plan.steps.filter((s) => s.kind === 'whole');
  const phraseSlow = plan.steps.filter((s) => s.kind === 'phrase-slow');
  assert.ok(listen.length > 0);
  listen.forEach((s) => assert.equal(s.bpm, 100));
  rhythm.forEach((s) => assert.equal(s.bpm, 100));
  chain.forEach((s) => assert.equal(s.bpm, 100));
  whole.forEach((s) => assert.equal(s.bpm, 100));
  assert.ok(phraseSlow.length > 0);
  phraseSlow.forEach((s) => assert.equal(s.bpm, Math.round(100 * 0.55)));
});

function fourBarSong(tempoMap) {
  return {
    schema: 'song/1', id: 'tempo-song', title: 'Tempo Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
    tempoMap,
    parts: [{
      id: 'melody', name: 'Melody', notes: [
        // bar 1
        { start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 },
        { start: 960, dur: 480, midi: 64 }, { start: 1440, dur: 480, midi: 65 },
        // bar 2: two half notes, the second held two beats (>= beat*2) -- a
        // natural resting point, so segment() breaks the phrase right here
        // and the next phrase opens at bar 3 (tick 3840, where the tempo
        // change below lands).
        { start: 1920, dur: 960, midi: 67 }, { start: 2880, dur: 960, midi: 69 },
        // bar 3 (tempo change lands here, tick 3840)
        { start: 3840, dur: 480, midi: 60 }, { start: 4320, dur: 480, midi: 62 },
        { start: 4800, dur: 480, midi: 64 }, { start: 5280, dur: 480, midi: 65 },
        // bar 4
        { start: 5760, dur: 480, midi: 67 }, { start: 6240, dur: 480, midi: 69 },
        { start: 6720, dur: 480, midi: 71 }, { start: 7200, dur: 480, midi: 72 },
      ]
    }],
    chords: []
  };
}

test("a phrase after a slowdown opens at the slower tempo", () => {
  const song = fourBarSong([{ tick: 3840, bpm: 60 }]);
  const plan = buildLessonPlan(song, 'melody', gtr);
  const rhythm = plan.steps.filter((s) => s.kind === 'rhythm' && s.originTick === 3840);
  assert.equal(rhythm.length, 1, 'expected exactly one rhythm step opening at bar 3 (tick 3840)');
  assert.equal(rhythm[0].bpm, 60);
  const phraseSlow = plan.steps.filter((s) => s.kind === 'phrase-slow' && s.originTick === 3840);
  assert.equal(phraseSlow.length, 1);
  assert.equal(phraseSlow[0].bpm, 33);
});

test('every step carries its tempoScale', () => {
  const song = hotCrossBuns();
  const plan = buildLessonPlan(song, 'melody', gtr);
  const byKind = {};
  plan.steps.forEach((s) => { byKind[s.kind] = byKind[s.kind] || s; });
  assert.equal(byKind.listen.tempoScale, 1);
  assert.equal(byKind.rhythm.tempoScale, 1);
  assert.equal(byKind.pitches.tempoScale, 0);
  assert.equal(byKind['phrase-slow'].tempoScale, 0.55);
  assert.ok(byKind['tempo-ladder'].tempoScale > 0 && byKind['tempo-ladder'].tempoScale <= 1);
  assert.equal(byKind.chain.tempoScale, 1);
  assert.equal(byKind.whole.tempoScale, 1);
  plan.steps.forEach((s) => assert.ok(typeof s.tempoScale === 'number', `${s.kind} missing tempoScale`));
});
