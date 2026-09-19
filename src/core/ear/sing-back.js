// Sing-back: a short target phrase the learner sings back, judged on pitch
// class only (any octave) - same reasoning as OCTAVE_POLICY.voice in
// src/core/judge.js. Wiring: make(level, seed) -> play through the app's
// synth; check() takes an array of heard MIDI numbers from the mic tracker.

import { makeRng, intRange } from './rng.js';
import { NOTE_NAMES, MAJOR_STEPS, diatonicPhrase, checkSequence } from './theory.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['3-note phrase, steps', '4-note phrase, steps', '5-note phrase, small leaps', '5-note phrase, leaps', '6-note phrase, leaps'];

const NOTE_COUNT_FOR_LEVEL = [3, 4, 5, 5, 6];
const MAX_STEP_FOR_LEVEL = [1, 1, 2, 3, 3];

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const idx = Math.min(Math.max(level - 1, 0), NOTE_COUNT_FOR_LEVEL.length - 1);
  const count = NOTE_COUNT_FOR_LEVEL[idx];
  const maxStep = MAX_STEP_FOR_LEVEL[idx];
  const tonicPc = intRange(rng, 0, 12);
  const midi = diatonicPhrase(rng, { count, maxStep, scale: MAJOR_STEPS, rootMidi: 60 + tonicPc });
  const play = midi.map((m, i) => ({ t: i * 0.6, dur: 0.55, midi: [m] }));

  return {
    id: `sing-back:${level}:${seed}`,
    prompt: `Sing back the ${count}-note phrase.`,
    play,
    choices: [],
    answer: midi,
    explain: `Key: ${NOTE_NAMES[tonicPc]} major. Notes: ${midi.join(', ')}.`,
  };
}

export function check(question, heardMidiList) {
  const pc = (m) => ((m % 12) + 12) % 12;
  const got = Array.isArray(heardMidiList) ? heardMidiList : [];
  return checkSequence(question.answer, got, (a, b) => pc(a) === pc(b));
}
