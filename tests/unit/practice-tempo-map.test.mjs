import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAttempt } from '../../src/ui/songs/practice.js';
import { createSongClock } from '../../src/song/clock.js';

// P4-2: judgeAttempt (and phraseSec underneath it) can be handed a song
// clock (src/song/clock.js) so a phrase spanning a tempoMap change is judged
// at the tempo in force at each tick, not at one flat bpm for the whole
// phrase.
const TPQ = 480;

function twoTempoSong() {
  return {
    schema: 'song/1', id: 'clock-song', title: 'Clock Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: TPQ,
    tempoMap: [{ tick: 1920, bpm: 60 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [] }],
    chords: []
  };
}

test('onsets after a tempo change are expected on the changed clock', () => {
  const song = twoTempoSong();
  const clock = createSongClock(song);
  const expected = [{ start: 2400, dur: 480, midi: 60 }];
  const r = judgeAttempt(expected, [{ midi: 60, atSec: 3.0 }], {
    bpm: clock.bpmAt(0), ticksPerQuarter: TPQ, policy: 'exact', originTick: 0, clock
  });
  assert.equal(r.hitRate, 1);
  assert.ok(Math.abs(r.meanErrorMs) < 1, 'errorMs ' + r.meanErrorMs);
});

test('the same take judged without a clock is late', () => {
  const song = twoTempoSong();
  const clock = createSongClock(song);
  const expected = [{ start: 2400, dur: 480, midi: 60 }];
  const r = judgeAttempt(expected, [{ midi: 60, atSec: 3.0 }], {
    bpm: clock.bpmAt(0), ticksPerQuarter: TPQ, policy: 'exact', originTick: 0
  });
  assert.equal(r.hitRate, 1);
  assert.ok(Math.abs(r.meanErrorMs - 500) < 1, 'errorMs ' + r.meanErrorMs);
});

test('hold length uses the tempo during the note', () => {
  const song = twoTempoSong();
  const clock = createSongClock(song);
  // A quarter note starting right after the tempo change (60bpm -> 1s/beat).
  const expected = [{ start: 1920, dur: 480, midi: 60 }];
  const r = judgeAttempt(expected, [{ midi: 60, atSec: 2.0, durSec: 1.0 }], {
    bpm: clock.bpmAt(0), ticksPerQuarter: TPQ, policy: 'exact', originTick: 0, clock
  });
  assert.equal(r.matches[0].ok, true);
  assert.ok(Math.abs(r.matches[0].durRatio - 1.0) < 1e-9, 'durRatio ' + r.matches[0].durRatio);
});

test('no clock: results identical to before (practice-phrase-origin fixtures)', () => {
  const expected = [{ start: 1920, dur: 480, midi: 60 }, { start: 2400, dur: 480, midi: 62 }];
  const played = [{ midi: 60, atSec: 0 }, { midi: 62, atSec: 0.5 }];
  const result = judgeAttempt(expected, played, { bpm: 120, ticksPerQuarter: TPQ, policy: 'exact', originTick: 1920 });
  assert.equal(result.hitRate, 1);
  assert.equal(result.meanErrorMs, 0);

  const pickup = [{ start: 240, dur: 240, midi: 64 }];
  const early = judgeAttempt(pickup, [{ midi: 64, atSec: 0 }], { bpm: 120, ticksPerQuarter: TPQ, originTick: 0 });
  assert.equal(early.hitRate, 1);
  assert.ok(Math.abs(early.meanErrorMs - 250) < 1e-9, 'timing error ' + early.meanErrorMs);
});
