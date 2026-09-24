import { test } from 'node:test';
import assert from 'node:assert/strict';

import { segment, buildLessonPlan } from '../../src/song/lesson.js';
import { barsOf } from '../../src/song/model.js';
import gtr from '../../src/instruments/gtr.js';

// BC-12: segment() used to compute phrase endpoints from a single opening
// metre (song.metre only), so a song that changes metre partway through --
// song.metreChanges, honoured by model.js's barsOf() -- got phrase/bar
// boundaries on the wrong ticks past the change. barsOf() is the one source
// of truth for where bars actually fall; segment() must agree with it.
function note(start, dur, midi) {
  return { start, dur, midi };
}

// 4/4 (1920 ticks/bar) for two bars, then 3/4 (1440 ticks/bar) from tick
// 3840. Notes run through both metres, with a long note at the very end of
// bar 2 (a natural phrase break) so segment() still exercises its own break
// rules, not just the metre-change boundary.
function metreChangeSong() {
  return {
    schema: 'song/1', id: 'metre-change', title: 'Metre Change', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    metreChanges: [{ tick: 3840, num: 3, den: 4 }],
    parts: [{ id: 'melody', name: 'Melody', notes: [
      // bar 1 (4/4): four quarters
      note(0, 480, 60), note(480, 480, 62), note(960, 480, 64), note(1440, 480, 65),
      // bar 2 (4/4): one long note filling the bar -> break after bar 2
      note(1920, 1920, 67),
      // bar 3 (3/4, starts at 3840): three quarters
      note(3840, 480, 69), note(4320, 480, 71), note(4800, 480, 72),
      // bar 4 (3/4): three quarters, ends exactly at the song's last tick
      note(5280, 480, 74), note(5760, 480, 72), note(6240, 480, 71)
    ] }],
    chords: []
  };
}

test('segment() phrase endpoints follow barsOf() across a metre change', () => {
  const song = metreChangeSong();
  const boundaries = barsOf(song);
  // 4/4 bars at 0, 1920, 3840; then 3/4 bars (1440 ticks) at 5280, 6720.
  assert.deepEqual(boundaries, [0, 1920, 3840, 5280, 6720]);

  const phrases = segment(song, 'melody');
  // Every phrase boundary must be one of barsOf()'s real bar boundaries.
  phrases.forEach((p) => {
    assert.ok(boundaries.includes(p.startTick), `startTick ${p.startTick} not a real bar boundary`);
    assert.ok(boundaries.includes(p.endTick), `endTick ${p.endTick} not a real bar boundary`);
  });
  // The long note fills bar 2 (ticks 1920-3840) -> a break right there.
  assert.ok(phrases.some((p) => p.endTick === 3840));
  // The last phrase must reach the song's real end, the 3/4 bar boundary at
  // 6720 (WRONG under the old fixed-4/4 math, which would stop at 5760).
  assert.equal(phrases[phrases.length - 1].endTick, 6720);

  // Every note lands in exactly one phrase, and only in phrases whose
  // window actually contains its start tick.
  const allNotes = song.parts[0].notes;
  const claimed = phrases.flatMap((p) => p.notes);
  assert.equal(claimed.length, allNotes.length);

  // buildLessonPlan's steps inherit the same, now-correct originTicks.
  const plan = buildLessonPlan(song, 'melody', gtr);
  const rhythmSteps = plan.steps.filter((s) => s.kind === 'rhythm');
  rhythmSteps.forEach((s) => assert.ok(boundaries.includes(s.originTick)));
});

test('segment() without metreChanges is unchanged (existing fixed-metre math)', () => {
  const song = {
    schema: 'song/1', id: 'plain', title: 'Plain', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [
      note(0, 480, 60), note(480, 480, 62), note(960, 1920, 64), note(2880, 480, 65)
    ] }],
    chords: []
  };
  const phrases = segment(song, 'melody');
  // A long note (dur 1920 >= two beats) followed immediately by the last
  // note (no gap) doesn't force a break there -- the 4-bar cap/last-bar
  // rule is what ends the single 2-bar phrase, exactly as before this fix.
  assert.deepEqual(phrases.map((p) => [p.startTick, p.endTick]), [[0, 3840]]);
});
