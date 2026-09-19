// Chord-progression recognition: I IV V vi ii iii in major, i iv v VI VII in
// minor, played as 3-4 chord loops. The learner names each chord by roman
// numeral.
//
// Wiring contract: call make(level, seed). Render `play` as block chords
// through the app's synth. Collect the learner's answer as an array of
// roman-numeral strings, in order, and pass {question, response} to check().
// `choices` is the roman-numeral set valid for the question's key (major or
// minor) - render as answer buttons, one pick per chord slot.

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES, MAJOR_STEPS } from './theory.js';

const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// Diatonic triad built from a scale's own steps, degree by degree - quality
// (and therefore roman-numeral case) falls out of the computed intervals,
// never a memorized chord-quality table.
function diatonicTriad(scale, degreeIndex) {
  const n = scale.length;
  return [0, 2, 4].map((step) => {
    const i = (degreeIndex + step) % n;
    const wraps = Math.floor((degreeIndex + step) / n);
    return scale[i] + wraps * 12;
  });
}

function triadQuality(triad) {
  const a = triad[1] - triad[0];
  const b = triad[2] - triad[1];
  if (a === 4 && b === 3) return 'major';
  if (a === 3 && b === 4) return 'minor';
  if (a === 3 && b === 3) return 'diminished';
  if (a === 4 && b === 4) return 'augmented';
  return 'other';
}

const ROMAN_BASE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function romanNumeral(degreeIndex, quality) {
  const base = ROMAN_BASE[degreeIndex];
  if (quality === 'minor') return base.toLowerCase();
  if (quality === 'diminished') return `${base.toLowerCase()}°`;
  if (quality === 'augmented') return `${base}+`;
  return base;
}

// 0-indexed scale degrees, restricted to the ones this exercise uses: I IV V
// vi ii iii in major (indices 0,3,4,5,1,2); i iv v VI VII in minor (indices
// 0,3,4,5,6).
const MAJOR_LOOPS = [
  [0, 3, 4], // I-IV-V
  [1, 4, 0], // ii-V-I
  [0, 4, 5, 3], // I-V-vi-IV
  [0, 5, 3, 4], // I-vi-IV-V
];
const MINOR_LOOPS = [
  [0, 5, 6], // i-VI-VII
  [0, 3, 4], // i-iv-v
  [0, 3, 4, 0], // i-iv-v-i
  [0, 6, 5, 6], // i-VII-VI-VII
];

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = [
  'Major loops, three chords',
  'Major loops, four chords',
  'Minor loops',
  'Major and minor mixed',
  'Major and minor mixed, new key every question',
];

function poolForLevel(level) {
  if (level <= 1) return MAJOR_LOOPS.filter((l) => l.length === 3);
  if (level === 2) return MAJOR_LOOPS;
  if (level === 3) return MINOR_LOOPS;
  return MAJOR_LOOPS.concat(MINOR_LOOPS);
}

function choicesFor(scale, degrees) {
  const seen = new Set();
  const out = [];
  for (const d of degrees) {
    const rn = romanNumeral(d, triadQuality(diatonicTriad(scale, d)));
    if (!seen.has(rn)) {
      seen.add(rn);
      out.push(rn);
    }
  }
  return out;
}

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const pool = poolForLevel(level);
  const loop = pickFrom(rng, pool);
  const isMinor = MINOR_LOOPS.includes(loop);
  const scale = isMinor ? NATURAL_MINOR_SCALE : MAJOR_STEPS;
  const tonicPc = level >= 5 ? intRange(rng, 0, 12) : 0;
  const root = 60 + tonicPc;

  const play = [];
  const answer = [];
  let t = 0;
  for (const degreeIndex of loop) {
    const triad = diatonicTriad(scale, degreeIndex);
    const midi = triad.map((iv) => root + iv);
    play.push({ t, dur: 0.9, midi });
    answer.push(romanNumeral(degreeIndex, triadQuality(triad)));
    t += 1.0;
  }

  const allDegrees = isMinor ? [0, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5];
  const choices = choicesFor(scale, allDegrees);

  return {
    id: `progressions:${level}:${seed}`,
    prompt: 'Name the chord progression, roman numeral by roman numeral.',
    play,
    choices,
    answer,
    explain: `Key: ${NOTE_NAMES[tonicPc]} ${isMinor ? 'minor' : 'major'}. Progression: ${answer.join('-')}.`,
  };
}

export function check(question, response) {
  const resp = Array.isArray(response) ? response : [response];
  const wrong = [];
  question.answer.forEach((rn, i) => {
    if (resp[i] !== rn) wrong.push({ index: i, expected: rn, got: resp[i] ?? null });
  });
  return { ok: wrong.length === 0 && resp.length === question.answer.length, detail: { wrong } };
}
