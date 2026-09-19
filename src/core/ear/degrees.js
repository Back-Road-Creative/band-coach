// Functional (scale-degree) ear training. A I-IV-V-I cadence establishes a
// key, then one or more scale degrees sound; the learner names each degree
// in order. Wiring: make(level, seed) -> play the cadence then the target
// note(s); the learner answers with an array of degree-label strings,
// checked against `choices` (render as answer buttons per degree slot, same
// shape as today's interval/chord buttons in src/app.js).

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES, checkSequence } from './theory.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['Tonic, dominant, mediant', 'All diatonic degrees', 'Chromatic degrees', 'Two degrees in a row', 'Three degrees in a row'];

// Semitone offset from the tonic -> functional label (movable-do,
// major-relative), the same "distance from a reference pitch" convention
// src/app.js already uses for its INTERVALS table.
const DEGREE_LABEL = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

const DIATONIC_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function poolForLevel(level) {
  if (level <= 1) return [0, 7, 4]; // 1, 5, 3: easiest to place by ear
  if (level === 2) return DIATONIC_MAJOR;
  return CHROMATIC; // levels 3+
}

function degreesPerQuestion(level) {
  if (level <= 3) return 1;
  if (level === 4) return 2;
  return 3;
}

// I-IV-V-I triads as semitone offsets from the tonic.
const CADENCE_CHORDS = [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]];

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const pool = poolForLevel(level);
  const n = degreesPerQuestion(level);
  // Key changes every question from level 2 up; level 1 stays in C so a
  // beginner locks onto one tonic pitch first.
  const tonicPc = level >= 2 ? intRange(rng, 0, 12) : 0;
  const root = 60 + tonicPc; // middle-C-anchored tonic

  const play = [];
  let t = 0;
  for (const chord of CADENCE_CHORDS) {
    // Keep every chord tone at or above the tonic (never wrap below it).
    const midi = chord.map((iv) => root + (iv < chord[0] ? iv + 12 : iv));
    play.push({ t, dur: 0.8, midi });
    t += 0.9;
  }
  t += 0.3; // a beat of silence before the target degree(s)

  const answer = [];
  for (let i = 0; i < n; i++) {
    const offset = pickFrom(rng, pool);
    const midi = root + offset + 12; // sound target degrees an octave above the cadence's tonic
    play.push({ t, dur: 0.9, midi: [midi] });
    t += 1.0;
    answer.push(DEGREE_LABEL[offset]);
  }

  const choices = pool.map((offset) => DEGREE_LABEL[offset]);

  return {
    id: `degrees:${level}:${seed}`,
    prompt: n === 1 ? 'Which scale degree do you hear?' : `Which ${n} scale degrees do you hear, in order?`,
    play,
    choices,
    answer,
    explain: `Key: ${NOTE_NAMES[tonicPc]} major. Cadence I-IV-V-I establishes the tonic; the target note${
      n > 1 ? 's are' : ' is'
    } scale degree${n > 1 ? 's' : ''} ${answer.join('-')}.`,
  };
}

export function check(question, response) {
  const resp = Array.isArray(response) ? response : [response];
  return checkSequence(question.answer, resp, (a, b) => a === b);
}
