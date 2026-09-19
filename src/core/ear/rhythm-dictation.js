// Rhythm dictation: one bar (then two) of 4/4 from a small note-value
// vocabulary. Wiring: make(level, seed) -> play on one fixed click pitch;
// the learner answers with onset times in ticks (480/quarter, matching
// src/song/model.js's Song shape), checked with an optional tolerance.

import { makeRng, pickFrom } from './rng.js';
import { checkSequence } from './theory.js';

const TICKS_PER_QUARTER = 480;
const BAR_TICKS = TICKS_PER_QUARTER * 4; // 4/4

function vocabularyForLevel(level) {
  if (level <= 1) return [TICKS_PER_QUARTER, TICKS_PER_QUARTER * 2]; // quarter, half
  if (level === 2) return [TICKS_PER_QUARTER, TICKS_PER_QUARTER / 2]; // quarter, eighth
  if (level === 3) return [TICKS_PER_QUARTER, TICKS_PER_QUARTER / 2, TICKS_PER_QUARTER * 1.5]; // + dotted quarter
  return [TICKS_PER_QUARTER, TICKS_PER_QUARTER / 2, TICKS_PER_QUARTER / 4, TICKS_PER_QUARTER * 1.5]; // + sixteenth
}

const barsForLevel = (level) => (level <= 3 ? 1 : 2);

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['One bar: quarters and halves', 'One bar: quarters and eighths', 'One bar: + dotted quarter', 'Two bars: + sixteenths', 'Two bars: full vocabulary'];

// Fill exactly one bar with note values drawn from `vocabulary`, always
// closing the bar exactly (the last value is clipped to what remains if
// nothing in the vocabulary divides it evenly).
function fillBar(rng, vocabulary, barTicks, out) {
  let remaining = barTicks;
  while (remaining > 0) {
    const candidates = vocabulary.filter((v) => v <= remaining);
    const dur = candidates.length ? pickFrom(rng, candidates) : remaining;
    out.push(dur);
    remaining -= dur;
  }
}

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const vocabulary = vocabularyForLevel(level);
  const bars = barsForLevel(level);
  const durations = [];
  for (let b = 0; b < bars; b++) fillBar(rng, vocabulary, BAR_TICKS, durations);

  let t = 0;
  const onsets = [];
  const play = durations.map((dur) => {
    onsets.push(t);
    const ev = { t: t / TICKS_PER_QUARTER, dur: dur / TICKS_PER_QUARTER, midi: [69] }; // fixed click pitch (A4)
    t += dur;
    return ev;
  });

  return {
    id: `rhythm-dictation:${level}:${seed}`,
    prompt: `Tap back the rhythm (${bars} bar${bars > 1 ? 's' : ''}).`,
    play,
    choices: [],
    answer: onsets,
    explain: `Onsets in ticks (${TICKS_PER_QUARTER}/quarter): ${onsets.join(', ')}.`,
  };
}

export function check(question, response, { toleranceTicks = 40 } = {}) {
  const got = Array.isArray(response) ? response : [];
  return checkSequence(question.answer, got, (a, b) => Math.abs(a - b) <= toleranceTicks);
}
