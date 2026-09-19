// Functional (scale-degree) ear training. A I-IV-V-I cadence establishes a
// key, then one or more scale degrees sound; the learner names each degree
// in order.
//
// Wiring contract: call make(level, seed) for a question. Render `play` (an
// ordered list of {t, dur, midi[]}, t/dur in seconds) through whatever synth
// the app already uses for the ear module. Collect the learner's answer as
// an array of degree-label strings, in order, and pass {question, response}
// to check(). `choices` is the full label set valid for the question's
// level - render it as buttons per degree slot, same shape as today's
// interval/chord answer buttons in src/app.js.

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES } from './theory.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = [
  'Tonic, dominant, mediant',
  'All diatonic degrees',
  'Chromatic degrees',
  'Two degrees in a row',
  'Three degrees in a row',
];

// Semitone offset from the tonic -> functional label. Fixed regardless of
// mode (movable-do, major-relative naming) - the same "distance from a
// reference pitch" convention src/app.js already uses for its INTERVALS
// table, rather than a mode-specific solfege system.
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
const CADENCE_CHORDS = [
  [0, 4, 7], // I
  [5, 9, 0], // IV
  [7, 11, 2], // V
  [0, 4, 7], // I
];

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
  const wrong = [];
  question.answer.forEach((deg, i) => {
    if (resp[i] !== deg) wrong.push({ index: i, expected: deg, got: resp[i] ?? null });
  });
  return { ok: wrong.length === 0 && resp.length === question.answer.length, detail: { wrong } };
}
