// Graded theory questions as deterministic data generators: { id, prompt,
// choices, answer, explain }. `make(level, seed, instrument)` never reads the
// clock or Math.random, so a session replays exactly. Wiring note: call
// `make` with the learner's instrument record (src/instruments/*.js), render
// `choices` as buttons, and pass the click to `check`.

import { ALL_KEYS, MAJOR_KEYS, signatureFor } from './keys.js';
import { scale } from './scales.js';
import { chord, diatonicChords, chordQualities } from './chords.js';
import { transposePhraseForInstrument, spellNotes } from './transpose.js';
import { spellingToString } from './pitch.js';

// A tiny deterministic PRNG (mulberry32) so `seed` alone controls every random
// choice below -- no Math.random, no wall-clock.
function rngFor(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function shuffledChoices(rng, correct, pool, count) {
  const others = pool.filter(x => x !== correct);
  const chosen = [];
  const spare = others.slice();
  while (chosen.length < count - 1 && spare.length) {
    const i = Math.floor(rng() * spare.length) % spare.length;
    chosen.push(spare.splice(i, 1)[0]);
  }
  const all = chosen.concat([correct]);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

function instrumentLabel(instrument) {
  return instrument ? instrument.name : 'your instrument';
}

function keySignatureQuestion(rng, instrument) { // level 1: name the key from its signature
  const key = pick(rng, ALL_KEYS);
  const sig = signatureFor(key);
  const desc = sig.count === 0 ? 'no sharps or flats' : sig.count + ' ' + sig.type + (sig.count === 1 ? '' : 's');
  const pool = ALL_KEYS.filter(k => k.mode === key.mode).map(k => k.name);
  const choices = shuffledChoices(rng, key.name, pool, 4);
  return {
    id: 'theory-key-signature',
    prompt: 'Which ' + key.mode + ' key has ' + desc + '?',
    choices,
    answer: key.name,
    explain: key.name + ' ' + key.mode + ' has ' + desc + '.',
  };
}

function buildChordQuestion(rng, instrument) { // level 2: build a chord
  const roots = MAJOR_KEYS.map(k => k.letter + k.accidental);
  const root = pick(rng, roots);
  const quality = pick(rng, chordQualities());
  const correct = chord(root, quality);
  const correctText = correct.notes.map(spellingToString).join(' ');
  const distractorQualities = chordQualities().filter(q => q !== quality);
  const distractors = [];
  while (distractors.length < 3 && distractorQualities.length) {
    const i = Math.floor(rng() * distractorQualities.length) % distractorQualities.length;
    const q = distractorQualities.splice(i, 1)[0];
    distractors.push(chord(root, q).notes.map(spellingToString).join(' '));
  }
  const choices = shuffledChoices(rng, correctText, distractors, Math.min(4, distractors.length + 1));
  return {
    id: 'theory-build-chord',
    prompt: 'Which notes make up ' + root + ' ' + quality + '?',
    choices,
    answer: correctText,
    explain: root + ' ' + quality + ' is ' + correctText + '.',
  };
}

function romanNumeralQuestion(rng, instrument) { // level 3: roman numeral of a major key
  const key = pick(rng, MAJOR_KEYS);
  const chords = diatonicChords(key);
  const target = pick(rng, chords);
  const correct = target.root;
  const pool = chords.map(c => c.root);
  const choices = shuffledChoices(rng, correct, pool, 4);
  return {
    id: 'theory-roman-numeral',
    prompt: 'In ' + key.name + ' major, what is the ' + target.numeral + ' chord?',
    choices,
    answer: correct,
    explain: 'The ' + target.numeral + ' of ' + key.name + ' major is ' + correct + ' ' + target.quality + '.',
  };
}

// Distractors are the neighbouring semitones, spelled for real in the
// written key, not an invented "note+shift" label.
function transposeQuestion(rng, instrument) { // level 4: transpose for the instrument
  const inst = instrument || { name: 'B flat trumpet', transposition: -2 };
  const startMidi = 60 + pick(rng, [0, 2, 4, 5, 7]);
  const result = transposePhraseForInstrument([{ start: 0, dur: 480, midi: startMidi }], { tonic: 0, mode: 'major' }, inst);
  const target = result.notes[0];
  const correct = spellingToString(target) + target.octave;
  const distractors = spellNotes([-2, -1, 1, 2].map(d => ({ midi: target.midi + d })), result.key)
    .map(n => spellingToString(n) + n.octave);
  const choices = shuffledChoices(rng, correct, distractors, 4);
  return {
    id: 'theory-transpose',
    prompt: 'On ' + instrumentLabel(inst) + ', what do you write for a concert-pitch note at MIDI ' + startMidi + '?',
    choices,
    answer: correct,
    explain: 'Concert MIDI ' + startMidi + ' written for ' + instrumentLabel(inst) + ' is ' + correct + '.',
  };
}

function scaleMembershipQuestion(rng, instrument) { // level 5: which notes are in this scale
  const key = pick(rng, MAJOR_KEYS);
  const built = scale({ letter: key.letter, accidental: key.accidental }, 'major');
  const inScale = pick(rng, built.degrees);
  const inScaleText = spellingToString(inScale);
  const outsidePcs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(pc => !built.degrees.some(d => d.pc === pc));
  const distractors = outsidePcs.slice(0, 3).map(pc => {
    const near = built.degrees.reduce((a, b) => (Math.abs(a.pc - pc) < Math.abs(b.pc - pc) ? a : b));
    return near.letter + (pc > near.pc ? '#' : 'b');
  });
  const choices = shuffledChoices(rng, inScaleText, distractors, Math.min(4, distractors.length + 1));
  return {
    id: 'theory-scale-membership',
    prompt: 'Which of these notes is in ' + key.name + ' major, on ' + instrumentLabel(instrument) + '?',
    choices,
    answer: inScaleText,
    explain: inScaleText + ' is scale degree ' + inScale.degree + ' of ' + key.name + ' major.',
  };
}

const LEVELS = [keySignatureQuestion, buildChordQuestion, romanNumeralQuestion, transposeQuestion, scaleMembershipQuestion];

export function levelCount() {
  return LEVELS.length;
}

// Deterministic: same (level, seed, instrument.id) always returns the same
// question. `level` is 1-based and clamps to the last level once past it.
export function make(level, seed, instrument) {
  const generator = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];
  const instrumentSalt = instrument && instrument.id ? Array.from(instrument.id).reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  const rng = rngFor((seed >>> 0) + level * 1000003 + instrumentSalt);
  return generator(rng, instrument);
}

export function check(question, response) {
  return response === question.answer;
}
