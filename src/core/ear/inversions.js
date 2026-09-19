// Chord-inversion recognition: triads root/1st/2nd, then sevenths with a 3rd
// inversion added. Wiring: make(level, seed) -> play one block chord; the
// learner answers with one pick from `choices` (an inversion name).

import { makeRng, intRange, pickFrom } from './rng.js';
import { NOTE_NAMES } from './theory.js';

const TRIAD_QUALITIES = { major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8] };
const SEVENTH_QUALITIES = {
  major7: [0, 4, 7, 11], dominant7: [0, 4, 7, 10], minor7: [0, 3, 7, 10], halfDiminished7: [0, 3, 6, 10], diminished7: [0, 3, 6, 9],
};

const TRIAD_INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion'];
const SEVENTH_INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['Triads, root position', 'Triads, root and 1st inversion', 'Triads, all inversions, all qualities', 'Seventh chords, root and 1st inversion', 'Seventh chords, all inversions'];

// Rotate the lowest `inversion` chord tones up an octave, then re-sort: the
// mechanical definition of "Nth inversion", computed per quality.
function voice(rootMidi, intervals, inversion) {
  const notes = intervals.map((iv) => rootMidi + iv);
  for (let i = 0; i < inversion; i++) notes[i] += 12;
  return notes.sort((a, b) => a - b);
}

const LEVEL_CONFIGS = [
  { qualities: ['major', 'minor'], table: TRIAD_QUALITIES, names: TRIAD_INVERSION_NAMES, maxInversion: 0 },
  { qualities: ['major', 'minor'], table: TRIAD_QUALITIES, names: TRIAD_INVERSION_NAMES, maxInversion: 1 },
  { qualities: Object.keys(TRIAD_QUALITIES), table: TRIAD_QUALITIES, names: TRIAD_INVERSION_NAMES, maxInversion: 2 },
  { qualities: Object.keys(SEVENTH_QUALITIES), table: SEVENTH_QUALITIES, names: SEVENTH_INVERSION_NAMES, maxInversion: 1 },
  { qualities: Object.keys(SEVENTH_QUALITIES), table: SEVENTH_QUALITIES, names: SEVENTH_INVERSION_NAMES, maxInversion: 3 },
];

function levelConfig(level) {
  return LEVEL_CONFIGS[Math.min(Math.max(level - 1, 0), LEVEL_CONFIGS.length - 1)];
}

export function make(level, seed) {
  const rng = makeRng(level, seed);
  const cfg = levelConfig(level);
  const qualityName = pickFrom(rng, cfg.qualities);
  const intervals = cfg.table[qualityName];
  const inversion = intRange(rng, 0, cfg.maxInversion + 1);
  const tonicPc = intRange(rng, 0, 12);
  const rootMidi = 60 + tonicPc;
  const midi = voice(rootMidi, intervals, inversion);

  return {
    id: `inversions:${level}:${seed}`,
    prompt: `Which inversion is this ${qualityName} chord in?`,
    play: [{ t: 0, dur: 1.6, midi }],
    choices: cfg.names.slice(0, cfg.maxInversion + 1),
    answer: cfg.names[inversion],
    explain: `${NOTE_NAMES[tonicPc]} ${qualityName}, ${cfg.names[inversion]}: sounding ${midi.join(', ')}.`,
  };
}

export function check(question, response) {
  const ok = response === question.answer;
  return { ok, detail: ok ? {} : { expected: question.answer, got: response } };
}
