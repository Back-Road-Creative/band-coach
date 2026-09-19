// Transposition: by a plain interval, and between instruments' written pitch
// (concert <-> Bb/Eb/F written, via the instrument record's `transposition`
// field -- e.g. trumpet-bb.js: -2, "sounding = written - 2", so
// concertMidi = writtenMidi + transposition). Spelling picks the enharmonic
// key with fewer accidentals when a pitch class has two (F#/Gb major both
// have 6) using keys.js's ALL_KEYS as the tie-break.

import { spellMidi } from '../../notation/spell.js';
import { ALL_KEYS, keyByTonicMode } from './keys.js';
import { mod12 } from './pitch.js';

// Shift every note's `midi` by `semitones`; leaves `start`/`dur` untouched.
export function transposeByInterval(notes, semitones) {
  return notes.map(n => ({ ...n, midi: n.midi + semitones }));
}

// From this instrument's written pitch to concert pitch.
export function writtenToConcert(notes, instrument) {
  return transposeByInterval(notes, instrument.transposition);
}

// From concert pitch to this instrument's written pitch.
export function concertToWritten(notes, instrument) {
  return transposeByInterval(notes, -instrument.transposition);
}

// Written-pitch notes on `fromInstrument`, re-written for `toInstrument`.
export function transposeBetweenInstruments(notes, fromInstrument, toInstrument) {
  return concertToWritten(writtenToConcert(notes, fromInstrument), toInstrument);
}

// Of the key(s) at this tonic/mode, the one with the fewest signature
// accidentals (a tie, e.g. F#/Gb major at 6 each, is broken toward sharps).
export function chooseEnharmonicKey(tonicPc, mode) {
  const candidates = ALL_KEYS.filter(k => k.tonic === mod12(tonicPc) && k.mode === mode);
  if (candidates.length === 0) throw new Error('no key at tonic ' + tonicPc + ' mode ' + mode);
  return candidates.reduce((best, k) => (k.signature.count < best.signature.count ? k : best));
}

// Moves a Song-shape `key` by `semitones`, respelling to fewer accidentals.
export function transposeKey(key, semitones) {
  const resolved = key && key.name ? key : keyByTonicMode(key.tonic, key.mode);
  return chooseEnharmonicKey(mod12(resolved.tonic + semitones), resolved.mode);
}

// Attaches spelling to each note via src/notation/spell.js against `key` --
// never re-derived here.
export function spellNotes(notes, key) {
  const keyName = typeof key === 'string' ? key : key.name;
  return notes.map(n => {
    const spelled = spellMidi(n.midi, keyName);
    return { ...n, letter: spelled.letter, accidental: spelled.accidental, octave: spelled.octave };
  });
}

// A concert-pitch phrase, written for `instrument` and spelled sensibly.
export function transposePhraseForInstrument(notes, concertKey, instrument) {
  const written = concertToWritten(notes, instrument);
  const writtenKey = transposeKey(concertKey, -instrument.transposition);
  return { notes: spellNotes(written, writtenKey), key: writtenKey };
}
