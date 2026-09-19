// Melodic dictation: a 3-8 note diatonic phrase, stepwise at low levels then
// with wider leaps. Wiring: make(level, seed) -> play; the learner answers
// with an array of MIDI notes. Pass `{ foldOctave: true }` to check() when
// the input instrument's octave policy is fold/nearest-octave (see
// src/core/judge.js OCTAVE_POLICY) so an octave slip is not marked wrong.

import { makeRng, intRange } from './rng.js';
import { NOTE_NAMES, MAJOR_STEPS, diatonicPhrase, checkSequence } from './theory.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['3 notes, steps only', '5 notes, steps only', '6 notes, small leaps', '7 notes, leaps', '8 notes, wide leaps'];

const NOTE_COUNT_FOR_LEVEL = [3, 5, 6, 7, 8];
const MAX_STEP_FOR_LEVEL = [1, 1, 2, 3, 4];

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const idx = Math.min(Math.max(level - 1, 0), NOTE_COUNT_FOR_LEVEL.length - 1);
  const count = NOTE_COUNT_FOR_LEVEL[idx];
  const maxStep = MAX_STEP_FOR_LEVEL[idx];
  const tonicPc = level >= 3 ? intRange(rng, 0, 12) : 0;
  const midi = diatonicPhrase(rng, { count, maxStep, scale: MAJOR_STEPS, rootMidi: 60 + tonicPc });
  const play = midi.map((m, i) => ({ t: i * 0.6, dur: 0.55, midi: [m] }));

  return {
    id: `melodic-dictation:${level}:${seed}`,
    prompt: `Play back the ${count}-note phrase you hear.`,
    play,
    choices: [],
    answer: midi,
    explain: `Key: ${NOTE_NAMES[tonicPc]} major. Notes: ${midi.join(', ')}.`,
  };
}

export function check(question, response, { foldOctave = false } = {}) {
  const got = Array.isArray(response) ? response : [];
  const norm = (m) => (foldOctave ? ((m % 12) + 12) % 12 : m);
  return checkSequence(question.answer, got, (a, b) => norm(a) === norm(b));
}
