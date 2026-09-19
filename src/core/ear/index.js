// Registry for the ear-training exercise modules. Each entry's `module`
// exposes make(level, seed) -> question and check(question, response) ->
// {ok, detail}. Wiring: pick an id, call makeQuestion, render `play`
// through the app's synth and `choices` as answer buttons (skip when empty -
// those exercises take a played/sung/typed response), then checkAnswer.

import * as degrees from './degrees.js';
import * as melodicDictation from './melodic-dictation.js';
import * as rhythmDictation from './rhythm-dictation.js';
import * as progressions from './progressions.js';
import * as scalesModes from './scales-modes.js';
import * as inversions from './inversions.js';
import * as intonation from './intonation.js';
import * as singBack from './sing-back.js';

function entry(mod, label) {
  return { module: mod, levels: mod.LEVEL_COUNT, levelNames: mod.LEVEL_NAMES, label };
}

export const EAR_EXERCISES = {
  degrees: entry(degrees, 'Scale degrees'),
  'melodic-dictation': entry(melodicDictation, 'Melodic dictation'),
  'rhythm-dictation': entry(rhythmDictation, 'Rhythm dictation'),
  progressions: entry(progressions, 'Chord progressions'),
  'scales-modes': entry(scalesModes, 'Scales and modes'),
  inversions: entry(inversions, 'Chord inversions'),
  intonation: entry(intonation, 'Intonation discrimination'),
  'sing-back': entry(singBack, 'Sing back'),
};

export function makeQuestion(exerciseId, level, seed) {
  return EAR_EXERCISES[exerciseId].module.make(level, seed);
}

export function checkAnswer(exerciseId, question, response, opts) {
  return EAR_EXERCISES[exerciseId].module.check(question, response, opts);
}
