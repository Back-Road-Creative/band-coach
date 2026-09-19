// Intonation discrimination: two tones, the second detuned by +-N cents (or
// not at all); tolerance shrinks 50 -> 5 cents as level rises. Wiring:
// make(level, seed) -> play, applying `cents` as a pitch-bend on `midi`.

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES } from './theory.js';

const CENTS_FOR_LEVEL = [50, 30, 20, 10, 5];

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = CENTS_FOR_LEVEL.map((c) => `+-${c} cents`);

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const idx = Math.min(Math.max(level - 1, 0), CENTS_FOR_LEVEL.length - 1);
  const n = CENTS_FOR_LEVEL[idx];
  const tonicPc = intRange(rng, 0, 12);
  const midi = 60 + tonicPc;
  const direction = pickFrom(rng, ['sharp', 'flat', 'same']);
  const centsOffset = direction === 'sharp' ? n : direction === 'flat' ? -n : 0;

  return {
    id: `intonation:${level}:${seed}`,
    prompt: 'Is the second tone sharp, flat, or the same as the first?',
    play: [{ t: 0, dur: 1.0, midi: [midi], cents: 0 }, { t: 1.2, dur: 1.0, midi: [midi], cents: centsOffset }],
    choices: ['sharp', 'flat', 'same'],
    answer: direction,
    explain: `Second tone is ${centsOffset} cents from ${NOTE_NAMES[tonicPc]} (level tolerance +-${n} cents).`,
  };
}

export function check(question, response) {
  const ok = response === question.answer;
  return { ok, detail: ok ? {} : { expected: question.answer, got: response } };
}
