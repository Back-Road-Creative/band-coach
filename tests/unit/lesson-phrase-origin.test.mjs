import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonPlan, segment } from '../../src/song/lesson.js';
import gtr from '../../src/instruments/gtr.js';

// BC-01: every step carries its phrase's segment start tick (originTick) so
// playback, capture and judging share one phrase-local clock -- the bar the
// lesson cut at, which keeps a pickup rest before the first note.
function song() {
  const n = (start, dur, midi) => ({ start, dur, midi });
  return {
    schema: 'song/1', id: 'origin', title: 'Origin', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 120, ticksPerQuarter: 480,
    parts: [{ id: 'm', name: 'M', notes: [
      // bar 1: an eighth-rest pickup, then notes, ending on a long note -> phrase break
      n(240, 240, 60), n(480, 480, 62), n(960, 960, 64),
      // bar 2: a beat of rest, then notes to the end of the bar
      n(2400, 480, 65), n(2880, 480, 67), n(3360, 480, 69),
    ] }],
    chords: [],
  };
}

test('every per-phrase step, rhythm included, carries its segment start tick as originTick', () => {
  const s = song();
  const phrases = segment(s, 'm');
  assert.ok(phrases.length >= 2, 'expected at least two phrases');
  const plan = buildLessonPlan(s, 'm', gtr);
  const rhythm = plan.steps.filter((st) => st.kind === 'rhythm');
  assert.equal(rhythm.length, phrases.length);
  rhythm.forEach((st) => assert.equal(st.originTick, phrases[st.phraseIndex].startTick));
  // The pickup: the first phrase starts at the bar (tick 0), not its first note (240).
  assert.equal(rhythm[0].originTick, 0);
  assert.equal(rhythm[1].originTick, 1920);
  plan.steps.filter((st) => st.phraseIndex != null && st.kind !== 'chain')
    .forEach((st) => assert.equal(st.originTick, phrases[st.phraseIndex].startTick, st.kind));
});

test('chain and whole-piece steps start at their first phrase\'s segment start', () => {
  const plan = buildLessonPlan(song(), 'm', gtr);
  plan.steps.filter((st) => st.kind === 'chain' || st.kind === 'whole')
    .forEach((st) => assert.equal(st.originTick, 0, st.kind));
});
