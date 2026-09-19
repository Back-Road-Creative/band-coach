// Scale and mode recognition. Every family here is COMPUTED from the major
// scale's own interval pattern rather than typed out by ear: modeIntervals()
// rotates the major scale to derive the other six modes; harmonic/melodic
// minor are each a one-note alteration of the derived natural minor;
// pentatonics and blues are subsets/additions of the derived major and
// natural-minor scales.
//
// Wiring contract: call make(level, seed). Render `play` (ascending, one
// octave plus the octave note) through the app's synth. Accept either a
// multiple-choice family-name response (render `choices` as buttons, same
// shape as today's ear-module answer buttons) or, if the learner played/sang
// the scale back, an array of heard MIDI notes - check() handles both.

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES, MAJOR_STEPS } from './theory.js';

export function modeIntervals(modeIndex) {
  const root = MAJOR_STEPS[modeIndex % 7];
  return MAJOR_STEPS.map((s) => (s - root + 12) % 12).sort((a, b) => a - b);
}

function raise(intervals, from, to) {
  return intervals.map((iv) => (iv === from ? to : iv));
}

const NATURAL_MINOR = modeIntervals(5); // aeolian
const HARMONIC_MINOR = raise(NATURAL_MINOR, 10, 11); // raised 7th
const MELODIC_MINOR = raise(HARMONIC_MINOR, 8, 9); // + raised 6th (ascending jazz form)
const MAJOR_PENTATONIC = MAJOR_STEPS.filter((iv) => iv !== 5 && iv !== 11); // drop 4th and 7th
const MINOR_PENTATONIC = NATURAL_MINOR.filter((iv) => iv !== 2 && iv !== 8); // drop 2nd and b6
const BLUES = [...MINOR_PENTATONIC, 6].sort((a, b) => a - b); // + the blue note (b5)

export const SCALE_FAMILIES = {
  major: { label: 'Major', intervals: MAJOR_STEPS },
  natural_minor: { label: 'Natural minor', intervals: NATURAL_MINOR },
  harmonic_minor: { label: 'Harmonic minor', intervals: HARMONIC_MINOR },
  melodic_minor: { label: 'Melodic minor (ascending)', intervals: MELODIC_MINOR },
  major_pentatonic: { label: 'Major pentatonic', intervals: MAJOR_PENTATONIC },
  minor_pentatonic: { label: 'Minor pentatonic', intervals: MINOR_PENTATONIC },
  blues: { label: 'Blues', intervals: BLUES },
  dorian: { label: 'Dorian', intervals: modeIntervals(1) },
  phrygian: { label: 'Phrygian', intervals: modeIntervals(2) },
  lydian: { label: 'Lydian', intervals: modeIntervals(3) },
  mixolydian: { label: 'Mixolydian', intervals: modeIntervals(4) },
  locrian: { label: 'Locrian', intervals: modeIntervals(6) },
};

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = [
  'Major and natural minor',
  'Harmonic and melodic minor',
  'Pentatonics',
  'Blues',
  'All seven modes',
];

function poolForLevel(level) {
  const keys = ['major', 'natural_minor'];
  if (level >= 2) keys.push('harmonic_minor', 'melodic_minor');
  if (level >= 3) keys.push('major_pentatonic', 'minor_pentatonic');
  if (level >= 4) keys.push('blues');
  if (level >= 5) keys.push('dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian');
  return keys;
}

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const pool = poolForLevel(level);
  const familyKey = pickFrom(rng, pool);
  const family = SCALE_FAMILIES[familyKey];
  const tonicPc = intRange(rng, 0, 12);
  const root = 60 + tonicPc;
  const ascendingIntervals = [...family.intervals, 12];
  const midi = ascendingIntervals.map((iv) => root + iv);
  const play = midi.map((m, i) => ({ t: i * 0.4, dur: 0.4, midi: [m] }));
  const scalePcs = ascendingIntervals.map((iv) => (tonicPc + iv) % 12);

  return {
    id: `scales-modes:${level}:${seed}`,
    prompt: 'Which scale or mode is this?',
    play,
    choices: pool.slice(),
    answer: familyKey,
    explain: `${NOTE_NAMES[tonicPc]} ${family.label}: ${scalePcs.map((pc) => NOTE_NAMES[pc]).join(' ')}.`,
    scalePcs,
  };
}

export function check(question, response) {
  if (Array.isArray(response)) {
    const got = response.map((m) => ((m % 12) + 12) % 12);
    const wrong = [];
    question.scalePcs.forEach((pc, i) => {
      if (got[i] !== pc) wrong.push({ index: i, expected: pc, got: got[i] ?? null });
    });
    return { ok: wrong.length === 0 && got.length === question.scalePcs.length, detail: { wrong } };
  }
  const ok = response === question.answer;
  return { ok, detail: ok ? {} : { expected: question.answer, got: response } };
}
