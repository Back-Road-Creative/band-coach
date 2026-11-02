// The pure timing behind every "when do I play?" cue: the beat number, the
// line that crosses each note on time, the ring that closes on a drum, the
// Songs runway. Everything here takes the clock as an argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatTimes, beatAt, sweepAt, drumRings, clicksThrough, cueClock, runwayBlocks, guideSpec } from '../../src/core/beat-cues.js';

test('beatTimes lays out one time per beat from the start', () => {
  assert.deepEqual(beatTimes(10, 0.5, 4), [10, 10.5, 11, 11.5]);
});

test('beatAt counts UP, wraps at the bar, and pulses hardest on the beat', () => {
  const times = beatTimes(0, 1, 8);
  assert.equal(beatAt(-0.01, times, 4), null, 'nothing before the first beat');
  assert.deepEqual(beatAt(0, times, 4), { n: 1, index: 0, pulse: 1 });
  assert.equal(beatAt(3.5, times, 4).n, 4);
  assert.equal(beatAt(3.5, times, 4).pulse, 0.5);
  assert.equal(beatAt(4, times, 4).n, 1, 'the second bar starts over at 1');
  assert.equal(beatAt(7.99, times, 4).n, 4);
  assert.equal(beatAt(8, times, 4), null, 'nothing after the last beat has run out');
});

test('beatAt follows uneven beats, so a tempo change keeps the count right', () => {
  const times = [0, 1, 1.5, 2];
  assert.equal(beatAt(1.25, times, 4).n, 2);
  assert.equal(beatAt(1.25, times, 4).pulse, 0.5);
});

test('sweepAt reaches every point exactly on its time, and stays inside the ends', () => {
  const pts = [{ t: 0, x: 0 }, { t: 4, x: 40 }, { t: 5, x: 100 }, { t: 6, x: 110 }];
  assert.equal(sweepAt(-1, pts), 0);
  assert.equal(sweepAt(2, pts), 20);
  assert.equal(sweepAt(4, pts), 40);
  assert.equal(sweepAt(4.5, pts), 70);
  assert.equal(sweepAt(5, pts), 100);
  assert.equal(sweepAt(99, pts), 110);
});

test('drumRings closes one ring per drum, on that drum\'s own next hit', () => {
  const onsets = [{ t: 1, pieces: ['kick', 'hihat-closed'] }, { t: 1.5, pieces: ['hihat-closed'] }, { t: 2, pieces: ['snare', 'hihat-closed'] }];
  const by = (rings) => Object.fromEntries(rings.map((r) => [r.piece, r.progress]));
  assert.deepEqual(drumRings(onsets, -0.5, 1), [], 'further off than the lead: nothing yet');
  assert.deepEqual(by(drumRings(onsets, 0.5, 1)), { kick: 0.5, 'hihat-closed': 0.5 });
  const later = by(drumRings(onsets, 1.25, 1));
  assert.equal(later.kick, undefined, 'a drum already past its hit has no ring');
  assert.equal(later['hihat-closed'], 0.75, 'the hi-hat rings for its next hit, not the far one');
  assert.equal(later.snare, 0.25);
  assert.equal(by(drumRings(onsets, 1, 1)).kick, 1, 'the ring lands exactly on the hit');
});

test('clicksThrough: never past the last level, never into an open mic that counts', () => {
  assert.equal(clicksThrough({ level: 1, levels: 9, micCounts: false }), true);
  assert.equal(clicksThrough({ level: 9, levels: 9, micCounts: false }), true);
  assert.equal(clicksThrough({ level: 10, levels: 9, micCounts: false }), false, 'past the last level you keep time yourself');
  assert.equal(clicksThrough({ level: 1, levels: 9, micCounts: true }), false, 'the mic would hear each click as a drum hit');
});

test('cueClock runs the visuals on the same clock the judge marks hits with', () => {
  // The judge takes latency (and the trainer's own learned offset) off the
  // moment a hit lands, so a hit in time is one that lands that much after
  // the note's time. The visuals have to meet the note at that same moment.
  assert.equal(cueClock(10, 300, 0), 9.7);
  assert.equal(cueClock(10, 0, 0.05), 9.95);
});

test('runwayBlocks scrolls notes toward the now line and drops what has left', () => {
  const notes = [{ sec: 0, dur: 0.5, row: 0 }, { sec: 1, dur: 0.5, row: 1 }, { sec: 9, dur: 0.5, row: 0 }];
  const at = runwayBlocks(notes, 0.5, { windowSec: 2, nowX: 100, width: 500 });
  assert.deepEqual(at.map((b) => b.row), [0, 1], 'the far note is still off the right edge');
  assert.equal(at[0].x, 0, 'half a second gone: 200 px per second behind the line');
  assert.equal(at[1].x, 200, 'half a second away: 100 px ahead of the line');
  assert.equal(at[1].w, 100);
  assert.deepEqual(runwayBlocks(notes, 3, { windowSec: 2, nowX: 100, width: 500 }), [], 'played and gone');
});

const song = { ticksPerQuarter: 480, metre: { num: 4, den: 4 } };
const sec = (tick, origin) => (tick - origin) / 480;
const pitched = [{ start: 480, dur: 480, midi: 60 }, { start: 960, dur: 240, midi: 67 }];

test('guideSpec: a timed try gets its beats, bar count and note rows', () => {
  const spec = guideSpec({ notes: pitched, originTick: 480, song, tickSec: sec, help: true, timed: true, kit: false, rhythmOnly: false });
  assert.equal(spec.perBar, 4);
  assert.deepEqual(spec.phraseBeats, [0, 1], 'one beat per quarter from the bar line to the last note end');
  assert.deepEqual(spec.notes.map((n) => n.sec), [0, 1]);
  assert.deepEqual(spec.notes.map((n) => n.row), [1, 0], 'the higher pitch sits on the higher row');
  assert.equal(spec.runway, true);
});

test('guideSpec: a drum part gets one named row per drum, cymbals on top, kick at the bottom', () => {
  const notes = [{ start: 0, dur: 480, piece: 'kick' }, { start: 480, dur: 480, piece: 'snare' }, { start: 960, dur: 480, piece: 'hihat-closed' }, { start: 1440, dur: 480, piece: 'kick' }];
  const spec = guideSpec({ notes, originTick: 0, song, tickSec: sec, help: true, timed: true, kit: true, rhythmOnly: false });
  assert.deepEqual(spec.rows, ['hihat-closed', 'snare', 'kick']);
  assert.deepEqual(spec.notes.map((n) => n.row), [2, 1, 0, 2]);
});

test('guideSpec: a rhythm step is one row, so it gives no pitch away', () => {
  const spec = guideSpec({ notes: pitched, originTick: 480, song, tickSec: sec, help: true, timed: true, kit: false, rhythmOnly: true });
  assert.deepEqual(spec.notes.map((n) => n.row), [0, 0]);
});

test('guideSpec: Check and untimed steps count you in and show nothing else', () => {
  for (const opts of [{ help: false, timed: true }, { help: true, timed: false }]) {
    const spec = guideSpec({ notes: pitched, originTick: 480, song, tickSec: sec, kit: false, rhythmOnly: false, ...opts });
    assert.equal(spec.runway, false);
    assert.deepEqual(spec.phraseBeats, []);
    assert.deepEqual(spec.notes, []);
  }
});

test('guideSpec: 6/8 counts six eighth-note beats to the bar', () => {
  const spec = guideSpec({ notes: [{ start: 0, dur: 1440, midi: 60 }], originTick: 0, song: { ticksPerQuarter: 480, metre: { num: 6, den: 8 } }, tickSec: sec, help: true, timed: true, kit: false, rhythmOnly: false });
  assert.equal(spec.perBar, 6);
  assert.deepEqual(spec.phraseBeats, [0, 0.5, 1, 1.5, 2, 2.5]);
});
